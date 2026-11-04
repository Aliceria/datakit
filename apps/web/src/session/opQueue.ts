import type { LogOp } from '@datakit/core';
import { ApiError, postOps } from '../api/client.ts';

// Fila de operações a enviar ao servidor (seção 5.2):
// - em lote, com debounce de ~300 ms;
// - guardada no sessionStorage a cada mudança, para sobreviver a F5 e a uma aba reaberta;
// - reenviada com espera crescente quando a rede falha;
// - protocolo de sequência da seção 5.4 (lacuna, conflito, repetição idempotente).

const KEY = 'dk.queue';
const DEBOUNCE_MS = 300;
const RETRY_MAX_MS = 30_000;
/** Lote máximo por requisição (em caracteres de JSON); colagens grandes vão sozinhas. */
const BATCH_CHARS = 8 * 1024 * 1024;

type Persisted = { documentKey: string; acked: number; ops: LogOp[] };

export type QueueEvents = {
  /** A fila ficou vazia e o servidor confirmou tudo. */
  onSaved: () => void;
  /** Há operações esperando envio. */
  onPending: () => void;
  /** Erro que a sessão precisa tratar (rede, expirada, instância substituída). */
  onSessionError: (err: ApiError) => Promise<void>;
  /** O servidor e esta aba divergiram: é preciso recarregar do servidor. */
  onDiverged: () => void;
};

let state: Persisted | undefined;
let events: QueueEvents | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let sending = false;
let retryDelay = 1000;

function persist(): void {
  try {
    if (state) sessionStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Sem espaço no sessionStorage: envia já, para encurtar a janela de risco.
    schedule(0);
  }
}

function readPersisted(): Persisted | undefined {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Persisted) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Começa a fila para o documento carregado. Devolve as operações guardadas que o servidor ainda
 * não tem (sequência acima de `headSeq`), para o chamador reaplicar localmente. A fila é ligada ao
 * arquivo aberto (não ao token): numa aba duplicada, as pendentes vão para a cópia, e o servidor
 * ignora as que a original já tinha entregado (mesmo opId).
 */
export function startQueue(documentKey: string, headSeq: number, handlers: QueueEvents): LogOp[] {
  events = handlers;
  const saved = readPersisted();
  let pending: LogOp[] = [];
  if (saved?.documentKey === documentKey) {
    let expected = headSeq + 1;
    for (const op of saved.ops.filter((o) => o.seq > headSeq).sort((a, b) => a.seq - b.seq)) {
      if (op.seq !== expected) break;
      pending.push(op);
      expected += 1;
    }
  } else {
    pending = [];
  }
  state = { documentKey, acked: headSeq, ops: pending };
  persist();
  if (pending.length > 0) {
    handlers.onPending();
    schedule(0);
  }
  return pending;
}

export function stopQueue(clear: boolean): void {
  if (timer !== undefined) clearTimeout(timer);
  timer = undefined;
  state = undefined;
  if (clear) {
    try {
      sessionStorage.removeItem(KEY);
    } catch {
      // Nada a fazer.
    }
  }
}

/**
 * Encerra a fila e espera o envio que estiver em andamento terminar. Usado antes de trocar o
 * documento da sessão: uma operação do arquivo antigo não pode chegar depois do arquivo novo.
 */
export async function stopQueueAndWait(): Promise<void> {
  stopQueue(true);
  while (sending) await new Promise((resolve) => setTimeout(resolve, 25));
}

export function nextSeq(): number {
  if (!state) throw new Error('Fila de operações não iniciada');
  return state.acked + state.ops.length + 1;
}

export function enqueue(op: LogOp): void {
  if (!state) return;
  state.ops.push(op);
  persist();
  events?.onPending();
  schedule(JSON.stringify(op).length > BATCH_CHARS / 8 ? 0 : DEBOUNCE_MS);
}

export function pendingOps(): readonly LogOp[] {
  return state?.ops ?? [];
}

export function hasPending(): boolean {
  return (state?.ops.length ?? 0) > 0;
}

function schedule(delay: number): void {
  if (timer !== undefined) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = undefined;
    void flush();
  }, delay);
}

/** Envia agora o que estiver pendente (exportação usa isto na Etapa 8). */
export async function flush(): Promise<void> {
  if (sending || !state || state.ops.length === 0) return;
  sending = true;
  const current = state;
  try {
    while (state === current && current.ops.length > 0) {
      const batch: LogOp[] = [];
      let size = 0;
      for (const op of current.ops) {
        const len = JSON.stringify(op).length;
        if (batch.length > 0 && size + len > BATCH_CHARS) break;
        batch.push(op);
        size += len;
        if (batch.length >= 500) break;
      }
      const acked = await postOps(batch);
      acknowledge(current, acked);
    }
    retryDelay = 1000;
    if (state === current) events?.onSaved();
  } catch (err) {
    if (state === current) await handleError(current, err);
  } finally {
    sending = false;
  }
}

function acknowledge(current: Persisted, acked: number): void {
  if (acked <= current.acked) return;
  current.ops = current.ops.filter((op) => op.seq > acked);
  current.acked = acked;
  persist();
}

async function handleError(current: Persisted, err: unknown): Promise<void> {
  if (!(err instanceof ApiError)) {
    schedule(retryDelay);
    return;
  }
  if (err.code === 'NETWORK' || err.status >= 500) {
    // Mantém a fila e tenta de novo, com espera crescente (barra: "Sem conexão…").
    await events?.onSessionError(err);
    schedule(retryDelay);
    retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS);
    return;
  }
  if (err.code === 'SEQ_GAP') {
    const head = Number(err.details?.['headSeq'] ?? -1);
    if (head >= current.acked) {
      // O servidor já tem parte do que achávamos pendente (resposta perdida): segue dali.
      acknowledge(current, head);
      schedule(0);
      return;
    }
    events?.onDiverged();
    return;
  }
  if (err.code === 'SEQ_CONFLICT') {
    events?.onDiverged();
    return;
  }
  // Expirada ou instância substituída: a sessão decide (copiar, expirar...). Depois, reenvia.
  await events?.onSessionError(err);
  if (state === current && current.ops.length > 0) schedule(retryDelay);
}

/** Depois que a aba virou cópia (novo token com a mesma cabeça), o reenvio continua igual. */
export function retrySoon(): void {
  if (hasPending()) schedule(0);
}

/**
 * Exportação (seção 10.3): envia tudo o que estiver pendente e devolve a última sequência que o
 * servidor confirmou. Lança erro se não conseguir esvaziar a fila (sem conexão, por exemplo).
 */
export async function syncedSeq(): Promise<number> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    while (sending) await new Promise((resolve) => setTimeout(resolve, 25));
    if (!state) throw new Error('Fila de operações não iniciada');
    if (state.ops.length === 0) return state.acked;
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    await flush();
  }
  throw new ApiError(0, 'NETWORK', 'Não foi possível salvar as últimas alterações. Tente de novo.');
}
