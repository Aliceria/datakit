import {
  STATE_VALUE,
  createMatcher,
  planSetTexts,
  replaceInText,
  type SearchOptions,
  type Table,
} from '@datakit/core';
import { activeTable, appStore } from './appStore.ts';
import { execute } from './editor.ts';
import { selectCell } from './selection.ts';
import { visibleRows } from './view.ts';

// Busca e substituição (seção 7.4) sobre a tabela ativa. A busca percorre a vista (linhas
// visíveis, na ordem mostrada), linha a linha e coluna a coluna, em todas as colunas ou numa só.

export type SearchScope = { options: SearchOptions; colId: string | null };

/** Contagem para mostrar no painel; acima do teto, mostra "mais de". */
export const COUNT_CAP = 100_000;
export const LIST_LIMIT = 500;

function columnsOf(table: Table, colId: string | null): number[] {
  if (colId === null) return table.columns.map((_, i) => i);
  const index = table.columns.findIndex((c) => c.id === colId);
  return index < 0 ? [] : [index];
}

export type Hit = { r: number; c: number };

/** Resultados na vista: contagem (até o teto) e os primeiros para a lista. */
export function scanMatches(
  table: Table,
  scope: SearchScope,
): { count: number; capped: boolean; first: Hit[] } {
  const test = createMatcher(scope.options);
  const rows = visibleRows(appStore.get(), table);
  const cols = columnsOf(table, scope.colId);
  const first: Hit[] = [];
  let count = 0;
  for (let r = 0; r < rows.length; r += 1) {
    const rowId = rows[r];
    if (rowId === undefined) continue;
    for (const c of cols) {
      const data = table.data.get(table.columns[c]?.id ?? '');
      if (!data || data.state[rowId] !== STATE_VALUE) continue;
      if (!test(data.raw[rowId] ?? '')) continue;
      count += 1;
      if (first.length < LIST_LIMIT) first.push({ r, c });
      if (count >= COUNT_CAP) return { count, capped: true, first };
    }
  }
  return { count, capped: false, first };
}

/** Próximo (ou anterior) resultado a partir da célula em foco, dando a volta na tabela. */
export function findNext(scope: SearchScope, direction: 1 | -1): Hit | undefined {
  const state = appStore.get();
  const table = activeTable(state);
  if (!table) return undefined;
  const test = createMatcher(scope.options);
  const rows = visibleRows(state, table);
  const cols = columnsOf(table, scope.colId);
  if (rows.length === 0 || cols.length === 0) return undefined;
  const total = rows.length * cols.length;
  const focus = state.selection?.focus;
  const colPos = focus ? Math.max(0, cols.indexOf(focus.c)) : direction === 1 ? -1 : 0;
  const start = focus ? focus.r * cols.length + colPos : direction === 1 ? -1 : total;
  for (let step = 1; step <= total; step += 1) {
    const idx = (((start + direction * step) % total) + total) % total;
    const r = Math.floor(idx / cols.length);
    const c = cols[idx % cols.length] ?? 0;
    const rowId = rows[r];
    const data = table.data.get(table.columns[c]?.id ?? '');
    if (rowId === undefined || !data || data.state[rowId] !== STATE_VALUE) continue;
    if (test(data.raw[rowId] ?? '')) return { r, c };
  }
  return undefined;
}

export function goToHit(hit: Hit): void {
  selectCell(hit.r, hit.c);
}

/** A célula em foco casa com a busca? (para "Substituir" agir nela) */
export function focusMatches(scope: SearchScope): boolean {
  const state = appStore.get();
  const table = activeTable(state);
  const focus = state.selection?.focus;
  if (!table || !focus) return false;
  if (scope.colId !== null && table.columns[focus.c]?.id !== scope.colId) return false;
  const rowId = visibleRows(state, table)[focus.r];
  const data = table.data.get(table.columns[focus.c]?.id ?? '');
  if (rowId === undefined || !data || data.state[rowId] !== STATE_VALUE) return false;
  return createMatcher(scope.options)(data.raw[rowId] ?? '');
}

/**
 * "Substituir": troca as ocorrências na célula em foco (se ela casar) e vai para a próxima.
 * Mantém o tipo nativo quando o resultado for compatível (L30).
 */
export function replaceCurrent(scope: SearchScope, replacement: string): boolean {
  const state = appStore.get();
  const table = activeTable(state);
  const focus = state.selection?.focus;
  if (!table || !focus || !focusMatches(scope)) {
    const next = findNext(scope, 1);
    if (next) goToHit(next);
    return false;
  }
  const rowId = visibleRows(state, table)[focus.r];
  const column = table.columns[focus.c];
  const data = column && table.data.get(column.id);
  if (rowId === undefined || !column || !data) return false;
  const raw = data.raw[rowId] ?? '';
  const next = replaceInText(raw, scope.options, replacement);
  if (next !== raw)
    execute('replace', 'Substituir', planSetTexts(table, [{ rowId, colId: column.id, raw: next }]));
  const after = findNext(scope, 1);
  if (after) goToHit(after);
  return true;
}

/** Plano de "Substituir todas" (seção 7.5: todas as linhas ou só as visíveis). */
export function planReplaceAll(
  scope: SearchScope,
  replacement: string,
  rowsScope: 'all' | 'visible',
): { cells: number; run: () => void } {
  const state = appStore.get();
  const table = activeTable(state);
  if (!table) return { cells: 0, run: () => undefined };
  const test = createMatcher(scope.options);
  const rows = rowsScope === 'all' ? table.rowOrder : visibleRows(state, table);
  const colIds = columnsOf(table, scope.colId).map((c) => table.columns[c]?.id ?? '');
  const items: Array<{ rowId: number; colId: string; raw: string }> = [];
  for (const rowId of rows) {
    for (const colId of colIds) {
      const data = table.data.get(colId);
      if (!data || data.state[rowId] !== STATE_VALUE) continue;
      const raw = data.raw[rowId] ?? '';
      if (!test(raw)) continue;
      const next = replaceInText(raw, scope.options, replacement);
      if (next !== raw) items.push({ rowId, colId, raw: next });
    }
  }
  return {
    cells: items.length,
    run: () => {
      if (items.length > 0) execute('replaceAll', 'Substituir todas', planSetTexts(table, items));
    },
  };
}
