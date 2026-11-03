// Estado de visualização (seção 4.3): não é operação e não vai para o histórico, mas volta depois
// do F5. Fica no sessionStorage da aba (L31): sobrevive a F5 e Ctrl+Shift+T e é copiado ao duplicar.
// Por enquanto: aba ativa e rolagem. Seleção, filtros, ordenação, busca e larguras entram com as
// funcionalidades (Etapas 5 e 6).

const KEY = 'dk.view';

export type TableView = { top: number; left: number };

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

export function rememberScroll(tableId: string, top: number, left: number): void {
  if (!current) return;
  current.tables[tableId] = { top, left };
  schedule();
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
