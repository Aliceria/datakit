import type {
  DocumentManifest,
  ImportOptions,
  ImportWarning,
  JsonRootKind,
  PreviewTable,
  Table,
} from '@datakit/core';
import { createStore, useStore } from './store.ts';

export type LoadedDocument = {
  manifest: DocumentManifest;
  tables: Table[];
};

/** Pré-visualização aberta (seção 6.1). */
export type PreviewState =
  | {
      kind: 'client';
      format: 'csv' | 'json';
      file: File;
      options: ImportOptions;
      table: PreviewTable | undefined;
      detected?: {
        encoding: NonNullable<ImportOptions['encoding']>;
        delimiter: NonNullable<ImportOptions['delimiter']>;
      };
      json?: { candidates: string[][]; kind: JsonRootKind };
      loading: boolean;
      error?: string;
    }
  | {
      kind: 'xlsx';
      file: File;
      stageId: string;
      hasHeader: boolean;
      tables: { withHeader: PreviewTable[]; withoutHeader: PreviewTable[] };
      warnings: { withHeader: ImportWarning[]; withoutHeader: ImportWarning[] };
      sheetIndex: number;
    };

export type MessageState = {
  title: string;
  tone: 'error' | 'warning' | 'info';
  lines: string[];
};

export type ConfirmState = {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
};

export type AppState = {
  doc: LoadedDocument | undefined;
  activeTableId: string | undefined;
  /** Texto do indicador de progresso; undefined quando nada está em andamento. */
  busy: string | undefined;
  preview: PreviewState | undefined;
  message: MessageState | undefined;
  confirm: ConfirmState | undefined;
};

export const appStore = createStore<AppState>({
  doc: undefined,
  activeTableId: undefined,
  busy: undefined,
  preview: undefined,
  message: undefined,
  confirm: undefined,
});

export const useApp = <S>(selector: (state: AppState) => S): S => useStore(appStore, selector);

export function activeTable(state: AppState): Table | undefined {
  return state.doc?.tables.find((t) => t.id === state.activeTableId);
}

export function showError(title: string, message: string): void {
  appStore.set({ message: { title, tone: 'error', lines: [message] }, busy: undefined });
}
