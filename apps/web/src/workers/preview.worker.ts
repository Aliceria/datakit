import {
  ImportError,
  buildPreview,
  inspectJson,
  readCsv,
  readJson,
  type ImportOptions,
} from '@datakit/core';
import type { PreviewRequest, PreviewResponse } from './previewTypes.ts';

// Pré-visualização de CSV e JSON no navegador, com o core (seção 6.1), fora da thread da interface.

const PREVIEW_ROWS = 20;

function run(request: PreviewRequest): PreviewResponse {
  const bytes = new Uint8Array(request.buffer);
  const options: ImportOptions = { ...request.options, maxRows: PREVIEW_ROWS };

  if (request.format === 'csv') {
    const doc = readCsv({ bytes, fileName: request.fileName, options });
    const table = doc.tables[0];
    return {
      id: request.id,
      ok: true,
      format: 'csv',
      needsConfirmation: true,
      table: table ? buildPreview(table, PREVIEW_ROWS) : undefined,
      detected: {
        encoding: doc.source.encoding ?? 'utf-8',
        delimiter: doc.source.delimiter ?? ',',
      },
    };
  }

  const { structure } = inspectJson(bytes);
  // Só pergunta quando há escolha a fazer: raiz objeto ou array de arrays (L32).
  const needsConfirmation = structure.rootIsObject || structure.kind === 'arrays';
  const doc = readJson({ bytes, fileName: request.fileName, options });
  const table = doc.tables[0];
  return {
    id: request.id,
    ok: true,
    format: 'json',
    needsConfirmation,
    table: table ? buildPreview(table, PREVIEW_ROWS) : undefined,
    json: { candidates: structure.candidates, kind: structure.kind },
  };
}

// Tipagem mínima do escopo do worker (o tsconfig do web usa a lib DOM, não a webworker).
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<PreviewRequest>) => void) | null;
  postMessage(message: PreviewResponse): void;
};

scope.onmessage = (event) => {
  let response: PreviewResponse;
  try {
    response = run(event.data);
  } catch (err) {
    response = {
      id: event.data.id,
      ok: false,
      message:
        err instanceof ImportError
          ? err.message
          : 'Não foi possível ler o arquivo para a pré-visualização.',
    };
  }
  scope.postMessage(response);
};
