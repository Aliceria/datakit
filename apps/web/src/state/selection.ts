import type { Table } from '@datakit/core';
import { rememberFocus, tableView } from '../session/viewState.ts';
import { activeTable, appStore, type Selection } from './appStore.ts';
import { visibleRows } from './view.ts';

/** Linhas visíveis da tabela (vista com filtro e ordenação, ou a ordem dos dados). */
const rowsOf = (table: Table): readonly number[] => visibleRows(appStore.get(), table);

// Seleção da grade (seção 7.2): célula, intervalo, colunas inteiras ou linhas inteiras.
// Os índices são da vista da tabela ativa (linhas visíveis, na ordem mostrada); a célula em foco vai para o estado de
// visualização por IDs, para voltar depois do F5.

export type Range = { r1: number; r2: number; c1: number; c2: number };

export function normalized(sel: Selection, table: Table): Range {
  const lastRow = Math.max(0, rowsOf(table).length - 1);
  const lastCol = Math.max(0, table.columns.length - 1);
  if (sel.mode === 'columns') {
    return {
      r1: 0,
      r2: lastRow,
      c1: Math.min(sel.anchor.c, sel.focus.c),
      c2: Math.max(sel.anchor.c, sel.focus.c),
    };
  }
  if (sel.mode === 'rows') {
    return {
      r1: Math.min(sel.anchor.r, sel.focus.r),
      r2: Math.max(sel.anchor.r, sel.focus.r),
      c1: 0,
      c2: lastCol,
    };
  }
  return {
    r1: Math.min(sel.anchor.r, sel.focus.r),
    r2: Math.max(sel.anchor.r, sel.focus.r),
    c1: Math.min(sel.anchor.c, sel.focus.c),
    c2: Math.max(sel.anchor.c, sel.focus.c),
  };
}

const clamp = (v: number, max: number) => Math.max(0, Math.min(v, max));

/** Ajusta a seleção ao tamanho atual da tabela (depois de excluir linhas ou colunas). */
export function clampSelection(sel: Selection, table: Table): Selection | undefined {
  const rows = rowsOf(table);
  if (rows.length === 0 || table.columns.length === 0) return undefined;
  const maxR = rows.length - 1;
  const maxC = table.columns.length - 1;
  return {
    mode: sel.mode,
    anchor: { r: clamp(sel.anchor.r, maxR), c: clamp(sel.anchor.c, maxC) },
    focus: { r: clamp(sel.focus.r, maxR), c: clamp(sel.focus.c, maxC) },
  };
}

export function setSelection(sel: Selection | undefined): void {
  const state = appStore.get();
  const table = activeTable(state);
  const next = sel && table ? clampSelection(sel, table) : undefined;
  appStore.set({ selection: next });
  if (!table) return;
  const rowId = next ? rowsOf(table)[next.focus.r] : undefined;
  const colId = next ? table.columns[next.focus.c]?.id : undefined;
  rememberFocus(table.id, rowId !== undefined && colId ? { rowId, colId } : undefined);
}

export function selectCell(r: number, c: number, extend = false): void {
  const current = appStore.get().selection;
  if (extend && current) {
    setSelection({
      mode: current.mode === 'cells' ? 'cells' : current.mode,
      anchor: current.anchor,
      focus: { r, c },
    });
  } else {
    setSelection({ mode: 'cells', anchor: { r, c }, focus: { r, c } });
  }
}

export function selectColumns(c: number, extend = false): void {
  const current = appStore.get().selection;
  const anchor = extend && current?.mode === 'columns' ? current.anchor : { r: 0, c };
  setSelection({ mode: 'columns', anchor, focus: { r: anchor.r, c } });
}

export function selectRows(r: number, extend = false): void {
  const current = appStore.get().selection;
  const anchor = extend && current?.mode === 'rows' ? current.anchor : { r, c: 0 };
  setSelection({ mode: 'rows', anchor, focus: { r, c: anchor.c } });
}

/** Volta à célula em foco guardada no estado de visualização, se ela ainda existir. */
export function restoreSelection(tableId: string): void {
  const state = appStore.get();
  const table = state.doc?.tables.find((t) => t.id === tableId);
  const focus = tableView(tableId)?.focus;
  if (!table || !focus) return;
  const r = rowsOf(table).indexOf(focus.rowId);
  const c = table.columns.findIndex((col) => col.id === focus.colId);
  if (r < 0 || c < 0) return;
  appStore.set({ selection: { mode: 'cells', anchor: { r, c }, focus: { r, c } } });
}

/** Linhas e colunas (por ID) cobertas pela seleção. */
export function selectedIds(sel: Selection, table: Table): { rowIds: number[]; colIds: string[] } {
  const { r1, r2, c1, c2 } = normalized(sel, table);
  return {
    rowIds: rowsOf(table).slice(r1, r2 + 1),
    colIds: table.columns.slice(c1, c2 + 1).map((c) => c.id),
  };
}
