import type { CellState } from '../model/cell.ts';
import { readCell, type Table } from '../model/table.ts';

/** Até ~20 linhas para a pré-visualização (seção 6.1). */
export const PREVIEW_ROWS = 20;

export type PreviewCell = { s: CellState; r: string };

export type PreviewTable = {
  name: string;
  hidden: boolean;
  columns: string[];
  rows: PreviewCell[][];
  /** Total de linhas da tabela (pode ser maior que as mostradas). */
  totalRows: number;
};

export function buildPreview(table: Table, maxRows = PREVIEW_ROWS): PreviewTable {
  const rowIds = table.rowOrder.slice(0, maxRows);
  return {
    name: table.name,
    hidden: table.hidden,
    columns: table.columns.map((c) => c.name),
    rows: rowIds.map((rowId) =>
      table.columns.map((column) => {
        const data = table.data.get(column.id);
        const cell = data ? readCell(data, rowId) : undefined;
        return { s: cell?.state ?? 0, r: cell?.raw ?? '' };
      }),
    ),
    totalRows: table.rowOrder.length,
  };
}
