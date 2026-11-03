import { STATE_ABSENT, STATE_NULL, STATE_VALUE } from '../model/cell.ts';
import type { Table } from '../model/table.ts';

export type TableStats = {
  rows: number;
  columns: number;
  /** Texto vazio (""). */
  emptyCells: number;
  /** Só espaços. */
  whitespaceCells: number;
  nullCells: number;
  absentCells: number;
  /** Linhas idênticas a uma linha anterior (estado, tipo nativo e texto de todas as colunas). */
  duplicateRows: number;
};

export function computeTableStats(table: Table): TableStats {
  const columns = table.columns.map((c) => table.data.get(c.id)).filter((d) => d !== undefined);
  let emptyCells = 0;
  let whitespaceCells = 0;
  let nullCells = 0;
  let absentCells = 0;
  let duplicateRows = 0;
  const seen = new Set<string>();

  for (const rowId of table.rowOrder) {
    let key = '';
    for (const data of columns) {
      const state = data.state[rowId];
      const raw = state === STATE_VALUE ? (data.raw[rowId] ?? '') : '';
      if (state === STATE_NULL) nullCells += 1;
      else if (state === STATE_ABSENT) absentCells += 1;
      else if (raw === '') emptyCells += 1;
      else if (raw.trim() === '') whitespaceCells += 1;
      // Separadores que não aparecem em texto comum; o comprimento evita ambiguidade.
      key += `${state}\u0001${data.native[rowId]}\u0001${raw.length}\u0001${raw}\u0002`;
    }
    if (seen.has(key)) duplicateRows += 1;
    else seen.add(key);
  }

  return {
    rows: table.rowOrder.length,
    columns: table.columns.length,
    emptyCells,
    whitespaceCells,
    nullCells,
    absentCells,
    duplicateRows,
  };
}
