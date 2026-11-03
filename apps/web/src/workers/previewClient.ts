import type { ImportOptions } from '@datakit/core';
import type { PreviewRequest, PreviewResponse } from './previewTypes.ts';

let worker: Worker | undefined;
let nextId = 1;
const pending = new Map<number, (response: PreviewResponse) => void>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./preview.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<PreviewResponse>) => {
      pending.get(event.data.id)?.(event.data);
      pending.delete(event.data.id);
    };
  }
  return worker;
}

/** Lê o arquivo e gera a pré-visualização no Web Worker. */
export async function requestPreview(
  file: File,
  format: 'csv' | 'json',
  options: ImportOptions,
): Promise<PreviewResponse> {
  const buffer = await file.arrayBuffer();
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    const request: PreviewRequest = { id, format, fileName: file.name, buffer, options };
    getWorker().postMessage(request, [buffer]);
  });
}
