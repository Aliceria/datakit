import { isFullExport, type ExportRequest } from '@datakit/core';
import { ApiError, exportFile } from '../api/client.ts';
import { handleSessionError } from '../session/sessionManager.ts';
import { syncedSeq } from '../session/opQueue.ts';
import { appStore, showError } from './appStore.ts';
import { markExported } from './editor.ts';

// Exportação (seção 10): esvazia a fila de operações, pede o arquivo ao servidor e baixa.

export function openExport(): void {
  const { doc, sessionStatus } = appStore.get();
  if (!doc || sessionStatus === 'expired') return;
  appStore.set({ exportOpen: true });
}

export function closeExport(): void {
  appStore.set({ exportOpen: false });
}

/** Baixa o conteúdo com o nome escolhido (link temporário, sem abrir aba nova). */
function download(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  // Dá tempo de o navegador começar o download antes de liberar a memória.
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 60_000);
}

export async function runExport(request: ExportRequest): Promise<void> {
  appStore.set({ exportOpen: false, busy: 'Gerando o arquivo…' });
  try {
    let blob: Blob | undefined;
    // Se outra operação chegar entre o envio e o pedido (NOT_SYNCED), sincroniza e tenta de novo.
    for (let attempt = 0; blob === undefined; attempt += 1) {
      const expectedSeq = await syncedSeq();
      try {
        blob = await exportFile({
          expectedSeq,
          fileName: request.fileName,
          tableIds: request.tableIds,
          options: request.options,
          ...(request.rowIds ? { rowIds: request.rowIds } : {}),
        });
      } catch (err) {
        if (!(err instanceof ApiError && err.code === 'NOT_SYNCED') || attempt >= 2) throw err;
      }
    }
    download(blob, request.fileName);
    if (isFullExport(request)) markExported(request.tableIds);
    appStore.set({ busy: undefined });
  } catch (err) {
    appStore.set({ busy: undefined });
    if (await handleSessionError(err).catch(() => false)) {
      if (err instanceof ApiError && err.code === 'NETWORK') {
        showError('Não foi possível exportar', err.message);
      }
      return;
    }
    showError(
      'Não foi possível exportar',
      err instanceof ApiError ? err.message : 'Erro inesperado ao gerar o arquivo.',
    );
  }
}
