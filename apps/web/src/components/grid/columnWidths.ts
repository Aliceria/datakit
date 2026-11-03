import type { Table } from '@datakit/core';

// Largura inicial das colunas, pela amostra do conteúdo (fonte monoespaçada de 13 px).
const CHAR_WIDTH = 7.8;
const PADDING = 18;
// Indicador de tipo + seta de ordenação (+ funil, quando há filtro).
const BADGE = 64;
const MIN = 64;
const MAX = 340;
const SAMPLE_ROWS = 200;

export function initialColumnWidths(table: Table): number[] {
  const sample = table.rowOrder.slice(0, SAMPLE_ROWS);
  return table.columns.map((column) => {
    const data = table.data.get(column.id);
    let longest = column.name.length * 0.9 + BADGE / CHAR_WIDTH;
    if (data) {
      for (const rowId of sample) {
        const raw = data.raw[rowId];
        if (raw !== undefined && raw.length > longest) longest = raw.length;
      }
    }
    return Math.round(Math.min(MAX, Math.max(MIN, longest * CHAR_WIDTH + PADDING)));
  });
}

export function rowNumberWidth(rowCount: number): number {
  return Math.max(44, String(rowCount).length * 8 + 20);
}
