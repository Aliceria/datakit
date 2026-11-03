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

/**
 * Acumulador de estatísticas, para calcular em fatias (sem travar a interface): chame addRows com
 * partes da ordem das linhas, na ordem, e depois result().
 */
export function createStatsAccumulator(table: Table) {
  const columns = table.columns.map((c) => table.data.get(c.id)).filter((d) => d !== undefined);
  const seen = new Set<string>();
  const stats: TableStats = {
    rows: table.rowOrder.length,
    columns: table.columns.length,
    emptyCells: 0,
    whitespaceCells: 0,
    nullCells: 0,
    absentCells: 0,
    duplicateRows: 0,
  };
  return {
    addRows(rowIds: readonly number[]): void {
      for (const rowId of rowIds) {
        let key = '';
        for (const data of columns) {
          const state = data.state[rowId];
          const raw = state === STATE_VALUE ? (data.raw[rowId] ?? '') : '';
          if (state === STATE_NULL) stats.nullCells += 1;
          else if (state === STATE_ABSENT) stats.absentCells += 1;
          else if (raw === '') stats.emptyCells += 1;
          else if (raw.trim() === '') stats.whitespaceCells += 1;
          // Separadores que não aparecem em texto comum; o comprimento evita ambiguidade.
          key += `${String(state)}\u0001${String(data.native[rowId])}\u0001${String(raw.length)}\u0001${raw}\u0002`;
        }
        if (seen.has(key)) stats.duplicateRows += 1;
        else seen.add(key);
      }
    },
    result(): TableStats {
      return { ...stats };
    },
  };
}

export function computeTableStats(table: Table): TableStats {
  const acc = createStatsAccumulator(table);
  acc.addRows(table.rowOrder);
  return acc.result();
}
