import {
  ImportError,
  applyChunk,
  assertFileSize,
  descriptorForFileName,
  applyLogOp,
  deserializeMarks,
  emptyHistory,
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
  fetchOpsAfter,
  fetchSessionState,
  getSessionToken,
  setSessionToken,
  stageXlsx,
  uploadFile,
  type ImportResponse,
} from '../api/client.ts';
import { startQueue, stopQueueAndWait } from '../session/opQueue.ts';
import { adoptSession, endSession, queueHandlers } from '../session/sessionManager.ts';
import { documentKey, loadViewState } from '../session/viewState.ts';
import { requestPreview } from '../workers/previewClient.ts';
import { appStore, showError, type LoadedDocument, type PreviewState } from './appStore.ts';
import { replayPending } from './editor.ts';
import { restoreSelection } from './selection.ts';
import { restoreViews } from './view.ts';

// Fluxo de importação (seções 2.3 e 6.1): validar → pré-visualizar se houver o que confirmar →
// enviar → baixar o documento processado pelo servidor.

const OPEN_ERROR = 'Não foi possível abrir o arquivo';

function errorMessage(err: unknown): string {
  if (err instanceof ImportError || err instanceof ApiError) return err.message;
  return 'Ocorreu um erro inesperado. Tente novamente.';
}

/**
 * Ponto de entrada: botão Abrir, Ctrl+O ou arrastar e soltar. Com alterações não exportadas,
 * pede confirmação antes de substituir o conteúdo da sessão (seção 6.1).
 */
export function openFile(file: File): Promise<void> {
  const changes = appStore.get().doc?.marks.changes ?? 0;
  if (changes === 0) return openConfirmed(file);
  return new Promise((resolve) => {
    appStore.set({
      confirm: {
        title: 'Abrir outro arquivo',
        message:
          `O arquivo aberto tem ${String(changes)} ${changes === 1 ? 'alteração' : 'alterações'} que ainda não ` +
          'foram exportadas. Abrir outro arquivo substitui o atual, e essas alterações serão perdidas.',
        confirmLabel: 'Abrir mesmo assim',
        onConfirm: () => {
          appStore.set({ confirm: undefined });
          void openConfirmed(file).then(resolve);
        },
      },
    });
  });
}

async function openConfirmed(file: File): Promise<void> {
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
  const previousStatus = appStore.get().sessionStatus;
  appStore.set({ busy: 'Importando…', sessionStatus: 'saving' });
  try {
    // O conteúdo da sessão vai ser substituído: nenhuma operação antiga pode chegar depois.
    await stopQueueAndWait();
    const result = await send();
    if (result.sessionId) setSessionToken(result.sessionId);
    const token = getSessionToken();
    if (token) await adoptSession(token);
    await loadDocument();
    showWarnings(result.warnings);
  } catch (err) {
    appStore.set({ sessionStatus: previousStatus });
    showError(OPEN_ERROR, errorMessage(err));
  }
}

/**
 * Carrega o documento do servidor: estado da sessão → manifesto e blocos daquela versão →
 * operações do log depois do snapshot → operações da fila desta aba que o servidor ainda não tem.
 * Se uma compactação trocar a versão no meio do caminho, recomeça (no máximo 3 vezes).
 */
export async function loadDocument(): Promise<void> {
  appStore.set({ busy: 'Carregando os dados…' });
  for (let attempt = 1; ; attempt += 1) {
    try {
      await loadOnce();
      return;
    } catch (err) {
      const retryable =
        err instanceof ApiError && (err.code === 'OPS_COMPACTED' || err.status === 404);
      if (!retryable || attempt >= 3) throw err;
    }
  }
}

async function loadOnce(): Promise<void> {
  const state = await fetchSessionState();
  const version = state.snapshotVersion;
  const manifest = await fetchManifest(version);
  const tables = manifest.tables.map(tableFromManifest);
  const jobs = manifest.tables.flatMap((tm, t) =>
    tm.chunks.map((index) => async () => {
      const payload = await fetchChunk(tm.id, index, version);
      const table = tables[t];
      if (table) applyChunk(table, payload);
    }),
  );
  // Até 4 blocos em paralelo.
  const workers = Array.from({ length: Math.min(4, jobs.length) }, async () => {
    for (let job = jobs.shift(); job; job = jobs.shift()) await job();
  });
  await Promise.all(workers);

  const doc: LoadedDocument = {
    manifest,
    tables,
    history: manifest.history ?? emptyHistory(),
    marks: deserializeMarks(manifest.marks),
    stats: Object.fromEntries(manifest.tables.map((t) => [t.id, t.stats])),
    inference: Object.fromEntries(manifest.tables.map((t) => [t.id, t.inference])),
  };
  const ops = await fetchOpsAfter(manifest.snapshotSeq ?? 0);
  for (const op of ops) applyLogOp(doc, op);
  const headSeq = ops.at(-1)?.seq ?? manifest.snapshotSeq ?? 0;

  // Volta à aba, à rolagem e à seleção em que o usuário estava (F5, aba reaberta ou duplicada).
  const key = documentKey(manifest.source);
  const view = loadViewState(key);
  const remembered = tables.find((t) => t.id === view.activeTableId);
  const firstVisible = tables.find((t) => !t.hidden) ?? tables[0];
  const activeTableId = (remembered ?? firstVisible)?.id;
  appStore.set({ doc, activeTableId, busy: undefined, selection: undefined, editing: undefined });

  const pending = startQueue(key, headSeq, queueHandlers);
  if (pending.length > 0) replayPending(pending);
  // Filtros e ordenação guardados voltam antes da seleção (que é um índice da vista).
  restoreViews();
  if (activeTableId) restoreSelection(activeTableId);
  appStore.set((s) => ({ revision: s.revision + 1 }));
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
  endSession();
  appStore.set({ doc: undefined, activeTableId: undefined, busy: undefined });
}
