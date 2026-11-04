import type {
  ColumnInference,
  DocumentManifest,
  History,
  Marks,
  TableStats,
  ImportOptions,
  ImportWarning,
  JsonRootKind,
  PreviewTable,
  Table,
} from '@datakit/core';
import { createStore, useStore } from './store.ts';
import type { ToolRequest } from './tools.ts';
import type { ViewModel } from './view.ts';

/** Documento aberto: é o estado de edição do core (tabelas, histórico, marcas) + derivados. */
export type LoadedDocument = {
  manifest: DocumentManifest;
  tables: Table[];
  history: History;
  marks: Marks;
  /** Estatísticas e inferência por tabela; recalculadas depois das operações (seção 9). */
  stats: Record<string, TableStats>;
  inference: Record<string, Record<string, ColumnInference>>;
};

/** Seleção na ordem visível da tabela ativa (índices de linha e de coluna). */
export type Selection = {
  anchor: { r: number; c: number };
  focus: { r: number; c: number };
  mode: 'cells' | 'rows' | 'columns';
};

export type EditingState = { r: number; c: number; initial: string; replace: boolean };

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

/** Estados da barra inferior (seção 5.3). */
export type SessionStatus = 'none' | 'saving' | 'saved' | 'offline' | 'expired';

export type AppState = {
  doc: LoadedDocument | undefined;
  activeTableId: string | undefined;
  /** Texto do indicador de progresso; undefined quando nada está em andamento. */
  busy: string | undefined;
  preview: PreviewState | undefined;
  message: MessageState | undefined;
  confirm: ConfirmState | undefined;
  sessionStatus: SessionStatus;
  /** Incrementado a cada mudança dos dados em memória (as tabelas são mutadas no lugar). */
  revision: number;
  selection: Selection | undefined;
  editing: EditingState | undefined;
  /** Sessão expirou com a aba aberta; canRestore quando ainda há dados na memória (L14). */
  expired: { canRestore: boolean } | undefined;
  /** Vistas com filtro ou ordenação, por tabela (sem entrada = ordem dos dados). */
  views: Record<string, ViewModel>;
  /** Diálogo de ferramenta de tratamento aberto (seção 8). */
  tool: ToolRequest | undefined;
  /** Células destacadas depois de uma conversão de tipo ("rowId:colId"). */
  flagged: { tableId: string; cells: Set<string> } | undefined;
  /** Diálogo Exportar aberto (seção 10). */
  exportOpen: boolean;
};

export const appStore = createStore<AppState>({
  doc: undefined,
  activeTableId: undefined,
  busy: undefined,
  preview: undefined,
  message: undefined,
  confirm: undefined,
  sessionStatus: 'none',
  expired: undefined,
  revision: 0,
  selection: undefined,
  editing: undefined,
  views: {},
  tool: undefined,
  flagged: undefined,
  exportOpen: false,
});

export const useApp = <S>(selector: (state: AppState) => S): S => useStore(appStore, selector);

export function activeTable(state: AppState): Table | undefined {
  return state.doc?.tables.find((t) => t.id === state.activeTableId);
}

export function showError(title: string, message: string): void {
  appStore.set({ message: { title, tone: 'error', lines: [message] }, busy: undefined });
}
