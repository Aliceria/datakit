import { STATE_VALUE } from '../model/cell.ts';
import { makeColumnNames } from '../model/headers.ts';
import type { Table } from '../model/table.ts';

/**
 * Usa a primeira linha como cabeçalho: os nomes vêm dela e ela sai da ordem das linhas.
 * Custa O(colunas); as células da linha continuam guardadas, mas não fazem mais parte da tabela.
 */
export function promoteHeaderRow(table: Table): { renamed: number } {
  const first = table.rowOrder[0];
  const candidates = table.columns.map((column) => {
    if (first === undefined) return undefined;
    const data = table.data.get(column.id);
    return data && data.state[first] === STATE_VALUE ? data.raw[first] : undefined;
  });
  const { names, renamed } = makeColumnNames(candidates);
  table.columns = table.columns.map((column, i) => ({ ...column, name: names[i] ?? column.name }));
  if (first !== undefined) table.rowOrder = table.rowOrder.slice(1);
  return { renamed };
}
