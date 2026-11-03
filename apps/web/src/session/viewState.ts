// Estado de visualização (seção 4.3): não é operação e não vai para o histórico, mas volta depois
// do F5. Fica no sessionStorage da aba (L31): sobrevive a F5 e Ctrl+Shift+T e é copiado ao duplicar.
// Guarda aba ativa, rolagem, célula selecionada e larguras de coluna. Filtros, ordenação e busca
// entram com essas funcionalidades (Etapa 6).

const KEY = 'dk.view';

export type TableView = {
  top: number;
  left: number;
  /** Célula em foco, por IDs (estáveis), para sobreviver a inserções e exclusões. */
  focus?: { rowId: number; colId: string };
  widths?: Record<string, number>;
};

export type ViewState = {
  /** Identifica o arquivo aberto: o estado de outro arquivo não é aplicado a este. */
  documentKey: string;
  activeTableId?: string;
  tables: Record<string, TableView>;
};

export const documentKey = (source: { fileName: string; importedAt: string }): string =>
  `${source.importedAt}|${source.fileName}`;

let current: ViewState | undefined;
let saveTimer: ReturnType<typeof setTimeout> | undefined;

export function loadViewState(key: string): ViewState {
  try {
    const raw = sessionStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as ViewState) : undefined;
    current = parsed?.documentKey === key ? parsed : { documentKey: key, tables: {} };
  } catch {
    current = { documentKey: key, tables: {} };
  }
  return current;
}

function persist(): void {
  try {
    if (current) sessionStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Sem sessionStorage: o estado só não sobrevive ao F5.
  }
}

/** Grava já (pagehide) ou daqui a pouco (rolagem contínua). */
export function flushViewState(): void {
  if (saveTimer !== undefined) clearTimeout(saveTimer);
  saveTimer = undefined;
  persist();
}

function schedule(): void {
  if (saveTimer !== undefined) return;
  saveTimer = setTimeout(flushViewState, 200);
}

export function rememberActiveTable(tableId: string): void {
  if (!current) return;
  current.activeTableId = tableId;
  flushViewState();
}

function entry(tableId: string): TableView | undefined {
  if (!current) return undefined;
  current.tables[tableId] ??= { top: 0, left: 0 };
  return current.tables[tableId];
}

export function rememberScroll(tableId: string, top: number, left: number): void {
  const view = entry(tableId);
  if (!view) return;
  view.top = top;
  view.left = left;
  schedule();
}

export function rememberFocus(
  tableId: string,
  focus: { rowId: number; colId: string } | undefined,
): void {
  const view = entry(tableId);
  if (!view) return;
  if (focus) view.focus = focus;
  else delete view.focus;
  schedule();
}

export function rememberWidth(tableId: string, colId: string, width: number): void {
  const view = entry(tableId);
  if (!view) return;
  view.widths = { ...view.widths, [colId]: width };
  flushViewState();
}

export function tableView(tableId: string): TableView | undefined {
  return current?.tables[tableId];
}

export function clearViewState(): void {
  current = undefined;
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nada a fazer.
  }
}
