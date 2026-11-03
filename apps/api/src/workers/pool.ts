import { Worker } from 'node:worker_threads';
import { log } from '../utils/log.ts';
import type { ParseRequest, ParseResponse } from './parseJob.ts';

// Executa o parsing em worker threads (seção 13), no máximo MAX_CONCURRENT por vez.
// Rodando do código-fonte (desenvolvimento e testes) o worker é o .ts; no build, o .js.

const MAX_CONCURRENT = 2;
const TIMEOUT_MS = 120_000;

const workerUrl = new URL(
  import.meta.url.endsWith('.ts') ? './parse.worker.ts' : './parse.worker.js',
  import.meta.url,
);

let running = 0;
const queue: Array<() => void> = [];

function acquire(): Promise<void> {
  if (running < MAX_CONCURRENT) {
    running += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    queue.push(() => {
      running += 1;
      resolve();
    });
  });
}

function release(): void {
  running -= 1;
  queue.shift()?.();
}

function isParseResponse(message: unknown): message is ParseResponse {
  return (
    typeof message === 'object' &&
    message !== null &&
    'ok' in message &&
    typeof message.ok === 'boolean' &&
    (message.ok ? 'kind' in message : 'error' in message)
  );
}

export async function parseInWorker(request: ParseRequest): Promise<ParseResponse> {
  await acquire();
  try {
    return await new Promise<ParseResponse>((resolve, reject) => {
      const worker = new Worker(workerUrl);
      const timer = setTimeout(() => {
        void worker.terminate();
        resolve({
          ok: false,
          error: { code: 'TIMEOUT', message: 'O arquivo demorou demais para ser processado.' },
        });
      }, TIMEOUT_MS);
      // Só a resposta do parsing interessa: com `node --watch`, o próprio Node também manda
      // mensagens internas por este canal.
      const onMessage = (message: unknown) => {
        if (!isParseResponse(message)) return;
        worker.off('message', onMessage);
        clearTimeout(timer);
        void worker.terminate();
        resolve(message);
      };
      worker.on('message', onMessage);
      worker.once('error', (err: Error) => {
        clearTimeout(timer);
        log.error('worker de parsing falhou', { error: err.message });
        reject(err);
      });
      // O ArrayBuffer é transferido, não copiado: o processo principal não guarda o arquivo bruto.
      const buffer = 'bytes' in request ? request.bytes.buffer : undefined;
      worker.postMessage(request, buffer instanceof ArrayBuffer ? [buffer] : []);
    });
  } finally {
    release();
  }
}
