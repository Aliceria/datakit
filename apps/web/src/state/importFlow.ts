import {
  ImportError,
  applyChunk,
  assertFileSize,
  descriptorForFileName,
  formatFromFileName,
  tableFromManifest,
  type ImportOptions,
  type ImportWarning,
} from '@datakit/core';
import {
  ApiError,
  commitStaged,
  deleteSession,
  fetchChunk,
  fetchManifest,
  setSessionToken,
  stageXlsx,
  uploadFile,
  type ImportResponse,
} from '../api/client.ts';
import { requestPreview } from '../workers/previewClient.ts';
import { appStore, showError, type PreviewState } from './appStore.ts';

// Fluxo de importação (seções 2.3 e 6.1): validar → pré-visualizar se houver o que confirmar →
// enviar → baixar o documento processado pelo servidor.

const OPEN_ERROR = 'Não foi possível abrir o arquivo';

function errorMessage(err: unknown): string {
  if (err instanceof ImportError || err instanceof ApiError) return err.message;
  return 'Ocorreu um erro inesperado. Tente novamente.';
}

/** Ponto de entrada: botão Abrir, Ctrl+O ou arrastar e soltar. */
export async function openFile(file: File): Promise<void> {
  let format;
  try {
    // Passos 1 e 2 da validação também no navegador, para responder na hora.
    format = formatFromFileName(file.name);
    assertFileSize(file.size);
  } catch (err) {
    showError(OPEN_ERROR, errorMessage(err));
    return;
  }

  const descriptor = descriptorForFileName(file.name);
  if (descriptor?.preview === 'server') {
    await stageOnServer(file);
    return;
  }
  if (format === 'xlsx') return;

  appStore.set({ busy: 'Lendo o arquivo…' });
  const response = await requestPreview(file, format, {});
  if (!response.ok) {
    showError(OPEN_ERROR, response.message);
    return;
  }
  if (!response.needsConfirmation) {
    await upload(file, {});
    return;
  }
  const options: ImportOptions =
    response.format === 'csv' && response.detected
      ? {
          encoding: response.detected.encoding,
          delimiter: response.detected.delimiter,
          hasHeader: true,
        }
      : {
          hasHeader: true,
          ...(response.json?.candidates[0] ? { jsonRootPath: response.json.candidates[0] } : {}),
        };
  appStore.set({
    busy: undefined,
    preview: {
      kind: 'client',
      format: response.format,
      file,
      options,
      table: response.table,
      ...(response.detected ? { detected: response.detected } : {}),
      ...(response.json ? { json: response.json } : {}),
      loading: false,
    },
  });
}

/** Opção mudou na pré-visualização: gera de novo. */
export async function updatePreviewOptions(patch: Partial<ImportOptions>): Promise<void> {
  const current = appStore.get().preview;
  if (current?.kind !== 'client') return;
  const options = { ...current.options, ...patch };
  appStore.set({ preview: { ...current, options, loading: true } });
  const response = await requestPreview(current.file, current.format, options);
  const latest = appStore.get().preview;
  if (latest?.kind !== 'client' || latest.file !== current.file) return;
  appStore.set({
    preview: response.ok
      ? { ...latest, options, table: response.table, loading: false }
      : { ...latest, options, table: undefined, loading: false, error: response.message },
  });
}

async function stageOnServer(file: File): Promise<void> {
  appStore.set({ busy: 'Enviando e lendo a planilha…' });
  try {
    const staged = await stageXlsx(file);
    const preview: PreviewState = {
      kind: 'xlsx',
      file,
      stageId: staged.stageId,
      hasHeader: true,
      tables: staged.preview,
      warnings: staged.warnings,
      sheetIndex: 0,
    };
    appStore.set({ busy: undefined, preview });
  } catch (err) {
    showError(OPEN_ERROR, errorMessage(err));
  }
}

export async function confirmPreview(): Promise<void> {
  const preview = appStore.get().preview;
  if (!preview) return;
  appStore.set({ preview: undefined });
  if (preview.kind === 'xlsx') {
    await finish(() => commitStaged(preview.stageId, preview.hasHeader));
  } else {
    await upload(preview.file, preview.options);
  }
}

export function cancelPreview(): void {
  appStore.set({ preview: undefined });
}

async function upload(file: File, options: ImportOptions): Promise<void> {
  await finish(() => uploadFile(file, options));
}

async function finish(send: () => Promise<ImportResponse>): Promise<void> {
  appStore.set({ busy: 'Importando…' });
  try {
    const result = await send();
    if (result.sessionId) setSessionToken(result.sessionId);
    await loadDocument();
    showWarnings(result.warnings);
  } catch (err) {
    showError(OPEN_ERROR, errorMessage(err));
  }
}

/** Baixa o manifesto e os blocos do snapshot e monta as tabelas em memória. */
export async function loadDocument(): Promise<void> {
  appStore.set({ busy: 'Carregando os dados…' });
  const manifest = await fetchManifest();
  const tables = manifest.tables.map(tableFromManifest);
  const jobs = manifest.tables.flatMap((tm, t) =>
    tm.chunks.map((index) => async () => {
      const payload = await fetchChunk(tm.id, index);
      const table = tables[t];
      if (table) applyChunk(table, payload);
    }),
  );
  // Até 4 blocos em paralelo.
  const workers = Array.from({ length: Math.min(4, jobs.length) }, async () => {
    for (let job = jobs.shift(); job; job = jobs.shift()) await job();
  });
  await Promise.all(workers);

  const firstVisible = tables.find((t) => !t.hidden) ?? tables[0];
  appStore.set({
    doc: { manifest, tables },
    activeTableId: firstVisible?.id,
    busy: undefined,
  });
}

function showWarnings(warnings: ImportWarning[]): void {
  if (warnings.length === 0) return;
  appStore.set({
    message: {
      title: 'Arquivo aberto com avisos',
      tone: 'warning',
      lines: warnings.map((w) => w.message),
    },
  });
}

/** "×" da aba do arquivo: confirma e apaga a sessão no servidor. */
export function requestCloseFile(): void {
  appStore.set({
    confirm: {
      title: 'Fechar o arquivo',
      message:
        'O arquivo será fechado e os dados temporários serão apagados do servidor. ' +
        'Alterações que não foram exportadas serão perdidas.',
      confirmLabel: 'Fechar arquivo',
      onConfirm: () => {
        void closeFile();
      },
    },
  });
}

async function closeFile(): Promise<void> {
  appStore.set({ confirm: undefined, busy: 'Fechando…' });
  try {
    await deleteSession();
  } catch (err) {
    // Sessão já expirada: o resultado é o mesmo.
    if (!(err instanceof ApiError && err.status === 410)) {
      showError('Não foi possível fechar o arquivo', errorMessage(err));
      return;
    }
  }
  setSessionToken(null);
  appStore.set({ doc: undefined, activeTableId: undefined, busy: undefined });
}
