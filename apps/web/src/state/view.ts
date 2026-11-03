import {
  ANY_COLUMN,
  FilterError,
  filterRows,
  sortRows,
  type ColumnFilter,
  type SortKey,
  type Table,
} from '@datakit/core';
import { rememberViewSpec, tableView } from '../session/viewState.ts';
import { appStore, showError, type AppState } from './appStore.ts';

// Vista da tabela (seção 7.4): as linhas visíveis, na ordem mostrada. Filtros e ordenação só
// mudam a vista, nunca os dados. Sem filtro nem ordenação, a vista é a própria ordem das linhas.
// Com eles, a lista é calculada ao aplicar e depois ajustada a cada operação: linhas excluídas
// saem, linhas novas entram perto de onde foram inseridas, e a vista fica "desatualizada" até
// ser reaplicada (uma linha editada não some da tela no meio do trabalho).

export type ViewSpec = { filters: ColumnFilter[]; sort: SortKey[] };

export type ViewModel = {
  spec: ViewSpec;
  rowIds: number[];
  /** Linhas que existiam quando a vista foi calculada (para reconhecer as novas). */
  known: Set<number>;
  /** Houve alteração nos dados depois do cálculo. */
  stale: boolean;
};

const collator = new Intl.Collator('pt-BR');

export const isActiveSpec = (spec: ViewSpec | undefined): spec is ViewSpec =>
  spec !== undefined && (spec.filters.length > 0 || spec.sort.length > 0);

/** Linhas visíveis da tabela, na ordem mostrada. */
export function visibleRows(state: Pick<AppState, 'views'>, table: Table): readonly number[] {
  return state.views[table.id]?.rowIds ?? table.rowOrder;
}

export function specOf(state: Pick<AppState, 'views'>, tableId: string): ViewSpec {
  return state.views[tableId]?.spec ?? { filters: [], sort: [] };
}

function compute(table: Table, spec: ViewSpec): number[] {
  const inference = appStore.get().doc?.inference[table.id] ?? {};
  const filtered = filterRows(table, table.rowOrder, spec.filters, inference);
  return spec.sort.length > 0
    ? sortRows(table, filtered, spec.sort, inference, collator.compare)
    : filtered;
}

function setView(tableId: string, view: ViewModel | undefined): void {
  appStore.set((s) => {
    const views = Object.fromEntries(Object.entries(s.views).filter(([id]) => id !== tableId));
    if (view) views[tableId] = view;
    return { views, selection: undefined, editing: undefined };
  });
}

/**
 * Aplica filtros e ordenação a uma tabela e guarda no estado de visualização (volta após F5).
 * Um valor de filtro inválido não muda nada e mostra a mensagem.
 */
export function applyViewSpec(tableId: string, spec: ViewSpec): boolean {
  const table = appStore.get().doc?.tables.find((t) => t.id === tableId);
  if (!table) return false;
  if (!isActiveSpec(spec)) {
    setView(tableId, undefined);
    rememberViewSpec(tableId, undefined);
    return true;
  }
  let rowIds: number[];
  try {
    rowIds = compute(table, spec);
  } catch (err) {
    if (err instanceof FilterError) {
      showError('Filtro inválido', err.message);
      return false;
    }
    throw err;
  }
  setView(tableId, { spec, rowIds, known: new Set(table.rowOrder), stale: false });
  rememberViewSpec(tableId, spec);
  return true;
}

/** Recalcula com os dados atuais ("Reaplicar"). */
export function reapplyView(tableId: string): void {
  const view = appStore.get().views[tableId];
  if (view) applyViewSpec(tableId, view.spec);
}

/** Depois de carregar o documento: volta os filtros e a ordenação guardados (F5). */
export function restoreViews(): void {
  const doc = appStore.get().doc;
  if (!doc) return;
  appStore.set({ views: {} });
  for (const table of doc.tables) {
    const saved = tableView(table.id)?.spec;
    if (!saved || !isActiveSpec(saved)) continue;
    // Filtros de colunas que não existem mais são descartados.
    const spec: ViewSpec = {
      filters: saved.filters.filter((f) => f.colId === ANY_COLUMN || table.data.has(f.colId)),
      sort: saved.sort.filter((k) => table.data.has(k.colId)),
    };
    try {
      if (isActiveSpec(spec)) {
        const rowIds = compute(table, spec);
        appStore.set((s) => ({
          views: {
            ...s.views,
            [table.id]: { spec, rowIds, known: new Set(table.rowOrder), stale: false },
          },
        }));
      }
    } catch {
      rememberViewSpec(table.id, undefined);
    }
  }
}

/** Onde pôr as linhas novas na vista, quando quem inseriu sabe (inserir acima/abaixo). */
const placementHints = new Map<number, number>();

export function hintPlacement(rowIds: readonly number[], viewIndex: number): void {
  rowIds.forEach((rowId, i) => placementHints.set(rowId, viewIndex + i));
}

/** Ajusta as vistas ativas depois de uma operação nos dados. */
export function adjustViews(tableIds: Iterable<string>): void {
  const state = appStore.get();
  const doc = state.doc;
  if (!doc) return;
  let views: AppState['views'] | undefined;
  for (const tableId of tableIds) {
    const view = state.views[tableId];
    const table = doc.tables.find((t) => t.id === tableId);
    if (!view || !table) continue;
    const present = new Set(table.rowOrder);
    // Colunas excluídas saem dos critérios.
    const spec: ViewSpec = {
      filters: view.spec.filters.filter((f) => f.colId === ANY_COLUMN || table.data.has(f.colId)),
      sort: view.spec.sort.filter((k) => table.data.has(k.colId)),
    };
    const rowIds = view.rowIds.filter((id) => present.has(id));
    const inView = new Set(rowIds);
    table.rowOrder.forEach((rowId, index) => {
      if (view.known.has(rowId) || inView.has(rowId)) return;
      const hint = placementHints.get(rowId);
      let at: number;
      if (hint !== undefined) {
        at = Math.min(hint, rowIds.length);
      } else {
        // Depois da linha anterior (na ordem dos dados) que estiver visível; senão, no fim.
        at = rowIds.length;
        for (let k = index - 1; k >= 0; k -= 1) {
          const prev = table.rowOrder[k];
          const pos = prev === undefined ? -1 : rowIds.indexOf(prev);
          if (pos >= 0) {
            at = pos + 1;
            break;
          }
        }
      }
      rowIds.splice(at, 0, rowId);
      inView.add(rowId);
    });
    placementHints.clear();
    views ??= { ...state.views };
    if (isActiveSpec(spec)) {
      views[tableId] = { spec, rowIds, known: present, stale: true };
    } else {
      // Os critérios eram só de colunas excluídas: volta à ordem dos dados.
      views = Object.fromEntries(Object.entries(views).filter(([id]) => id !== tableId));
    }
    rememberViewSpec(tableId, isActiveSpec(spec) ? spec : undefined);
  }
  if (views) appStore.set({ views });
}

// --- Comandos de filtro e ordenação ------------------------------------------------------------

export function setColumnFilter(
  tableId: string,
  colId: string,
  condition: ColumnFilter['condition'] | undefined,
): boolean {
  const spec = specOf(appStore.get(), tableId);
  const filters = spec.filters.filter((f) => f.colId !== colId);
  if (condition) filters.push({ colId, condition });
  return applyViewSpec(tableId, { ...spec, filters });
}

export function clearFilters(tableId: string): void {
  applyViewSpec(tableId, { ...specOf(appStore.get(), tableId), filters: [] });
}

/**
 * Seta de ordenação no cabeçalho (seção 7.4, L43): alterna crescente → decrescente → sem
 * ordenação. Com Shift, acrescenta como critério secundário em vez de substituir.
 */
export function toggleSort(tableId: string, colId: string, additive: boolean): void {
  const spec = specOf(appStore.get(), tableId);
  const current = spec.sort.find((k) => k.colId === colId);
  const next: SortKey['direction'] | undefined =
    current === undefined ? 'asc' : current.direction === 'asc' ? 'desc' : undefined;
  setSort(tableId, colId, next, additive);
}

export function setSort(
  tableId: string,
  colId: string,
  direction: SortKey['direction'] | undefined,
  additive = false,
): void {
  const spec = specOf(appStore.get(), tableId);
  let sort: SortKey[];
  if (additive) {
    const exists = spec.sort.some((k) => k.colId === colId);
    if (!direction) sort = spec.sort.filter((k) => k.colId !== colId);
    else if (exists) sort = spec.sort.map((k) => (k.colId === colId ? { colId, direction } : k));
    else sort = [...spec.sort, { colId, direction }];
  } else {
    sort = direction ? [{ colId, direction }] : spec.sort.filter((k) => k.colId !== colId);
  }
  applyViewSpec(tableId, { ...spec, sort });
}

export function clearSort(tableId: string): void {
  applyViewSpec(tableId, { ...specOf(appStore.get(), tableId), sort: [] });
}

/** Ordem de todas as linhas (inclusive as escondidas pelo filtro) pelos critérios atuais. */
export function sortedDataOrder(tableId: string): number[] | undefined {
  const state = appStore.get();
  const table = state.doc?.tables.find((t) => t.id === tableId);
  const spec = specOf(state, tableId);
  if (!table || spec.sort.length === 0) return undefined;
  const inference = state.doc?.inference[tableId] ?? {};
  return sortRows(table, table.rowOrder, spec.sort, inference, collator.compare);
}
