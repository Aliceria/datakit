// Efeitos: o resultado já resolvido de uma operação, em dados puros (docs/PLANO.md, seção 2.2).
// O navegador calcula o efeito a partir da intenção do usuário; navegador e servidor aplicam o
// mesmo efeito com as mesmas funções. Cada aplicação devolve o efeito inverso, para desfazer.
// Nada aqui depende de Intl, Date ou Unicode do motor: o resultado é idêntico nos dois lados.

import {
  NATIVE,
  STATE_NULL,
  STATE_VALUE,
  type CellExtras,
  type CellState,
  type NativeCode,
} from '../model/cell.ts';
import { createColumnData, type Column, type ColumnData, type Table } from '../model/table.ts';

/** Valor completo de uma célula, como viaja num efeito. */
export type CellValue = {
  s: CellState;
  /** Texto; só quando s = STATE_VALUE. */
  r?: string;
  t: NativeCode;
  x?: CellExtras;
};

export const EMPTY_TEXT: CellValue = { s: STATE_VALUE, r: '', t: NATIVE.none };
export const NULL_VALUE: CellValue = { s: STATE_NULL, t: NATIVE.none };

export type CellChange = { rowId: number; colId: string; value: CellValue };

export type InsertedRow = {
  rowId: number;
  /** Posição na ordem das linhas depois da inserção (inserções aplicadas em ordem crescente). */
  index: number;
  /** Células que não são texto vazio; as demais começam vazias. */
  cells?: Record<string, CellValue>;
};

export type InsertedColumn = {
  column: Column;
  index: number;
  /** Células que não são texto vazio, por ID de linha. */
  cells?: Record<string, CellValue>;
};

export type Effect =
  | { type: 'setCells'; tableId: string; cells: CellChange[] }
  | { type: 'insertRows'; tableId: string; rows: InsertedRow[] }
  | { type: 'deleteRows'; tableId: string; rowIds: number[] }
  | { type: 'insertColumns'; tableId: string; columns: InsertedColumn[] }
  | { type: 'deleteColumns'; tableId: string; colIds: string[] }
  | { type: 'renameColumn'; tableId: string; colId: string; name: string; path?: string[] }
  | { type: 'batch'; effects: Effect[] };

export class EffectError extends Error {}

function findTable(tables: readonly Table[], id: string): Table {
  const table = tables.find((t) => t.id === id);
  if (!table) throw new EffectError(`Tabela inexistente: ${id}`);
  return table;
}

function columnOf(table: Table, colId: string): ColumnData {
  const data = table.data.get(colId);
  if (!data) throw new EffectError(`Coluna inexistente: ${colId}`);
  return data;
}

/** Garante espaço nos arrays tipados para IDs de linha até `rowCount - 1`. */
function ensureCapacity(table: Table, rowCount: number): void {
  for (const data of table.data.values()) {
    if (data.state.length >= rowCount) continue;
    const capacity = Math.max(rowCount, Math.ceil(data.state.length * 1.5) + 16);
    const state = new Uint8Array(capacity);
    state.set(data.state);
    const native = new Uint8Array(capacity);
    native.set(data.native);
    data.state = state;
    data.native = native;
  }
}

export function readValue(data: ColumnData, rowId: number): CellValue {
  const s = (data.state[rowId] ?? STATE_VALUE) as CellState;
  const t = (data.native[rowId] ?? NATIVE.none) as NativeCode;
  const x = data.extras.get(rowId);
  const value: CellValue = s === STATE_VALUE ? { s, r: data.raw[rowId] ?? '', t } : { s, t };
  if (x) value.x = x;
  return value;
}

export function writeValue(data: ColumnData, rowId: number, value: CellValue): void {
  data.state[rowId] = value.s;
  data.raw[rowId] = value.s === STATE_VALUE ? (value.r ?? '') : undefined;
  data.native[rowId] = value.t;
  if (value.x) data.extras.set(rowId, value.x);
  else data.extras.delete(rowId);
}

const isEmptyText = (v: CellValue): boolean =>
  v.s === STATE_VALUE && (v.r ?? '') === '' && v.t === NATIVE.none && v.x === undefined;

function assertRowExists(table: Table, rowId: number, present: Set<number>): void {
  if (!Number.isInteger(rowId) || rowId < 0 || rowId >= table.nextRowId || !present.has(rowId)) {
    throw new EffectError(`Linha inexistente: ${String(rowId)}`);
  }
}

/** Aplica o efeito às tabelas (mutando-as) e devolve o efeito que o desfaz. */
export function applyEffect(tables: Table[], effect: Effect): Effect {
  switch (effect.type) {
    case 'setCells': {
      const table = findTable(tables, effect.tableId);
      const present = new Set(table.rowOrder);
      const previous: CellChange[] = [];
      for (const change of effect.cells) {
        assertRowExists(table, change.rowId, present);
        const data = columnOf(table, change.colId);
        previous.push({
          rowId: change.rowId,
          colId: change.colId,
          value: readValue(data, change.rowId),
        });
        writeValue(data, change.rowId, change.value);
      }
      // Desfazer aplica na ordem inversa (vale quando a mesma célula aparece duas vezes).
      return { type: 'setCells', tableId: table.id, cells: previous.reverse() };
    }

    case 'insertRows': {
      const table = findTable(tables, effect.tableId);
      const existing = new Set(table.rowOrder);
      const maxId = effect.rows.reduce((m, r) => Math.max(m, r.rowId), -1);
      ensureCapacity(table, maxId + 1);
      const order = [...table.rowOrder];
      const sorted = [...effect.rows].sort((a, b) => a.index - b.index);
      for (const row of sorted) {
        if (!Number.isInteger(row.rowId) || row.rowId < 0 || existing.has(row.rowId)) {
          throw new EffectError(`ID de linha já usado: ${String(row.rowId)}`);
        }
        if (row.index < 0 || row.index > order.length) throw new EffectError('Posição inválida');
        existing.add(row.rowId);
        order.splice(row.index, 0, row.rowId);
        for (const column of table.columns) {
          writeValue(columnOf(table, column.id), row.rowId, row.cells?.[column.id] ?? EMPTY_TEXT);
        }
        if (row.cells) {
          for (const colId of Object.keys(row.cells)) columnOf(table, colId);
        }
      }
      table.rowOrder = order;
      table.nextRowId = Math.max(table.nextRowId, maxId + 1);
      return { type: 'deleteRows', tableId: table.id, rowIds: sorted.map((r) => r.rowId) };
    }

    case 'deleteRows': {
      const table = findTable(tables, effect.tableId);
      const remove = new Set(effect.rowIds);
      const present = new Set(table.rowOrder);
      for (const rowId of remove) assertRowExists(table, rowId, present);
      const removed: InsertedRow[] = [];
      table.rowOrder.forEach((rowId, index) => {
        if (!remove.has(rowId)) return;
        const cells: Record<string, CellValue> = {};
        for (const column of table.columns) {
          const value = readValue(columnOf(table, column.id), rowId);
          if (!isEmptyText(value)) cells[column.id] = value;
        }
        removed.push(Object.keys(cells).length > 0 ? { rowId, index, cells } : { rowId, index });
      });
      table.rowOrder = table.rowOrder.filter((rowId) => !remove.has(rowId));
      return { type: 'insertRows', tableId: table.id, rows: removed };
    }

    case 'insertColumns': {
      const table = findTable(tables, effect.tableId);
      const columns = [...table.columns];
      const present = new Set(table.rowOrder);
      const sorted = [...effect.columns].sort((a, b) => a.index - b.index);
      let maxCol = table.nextColId;
      for (const inserted of sorted) {
        const { column } = inserted;
        if (table.data.has(column.id)) throw new EffectError(`ID de coluna já usado: ${column.id}`);
        if (inserted.index < 0 || inserted.index > columns.length) {
          throw new EffectError('Posição inválida');
        }
        const data = createColumnData(Math.max(table.nextRowId, 1), STATE_VALUE);
        for (const [rowKey, value] of Object.entries(inserted.cells ?? {})) {
          const rowId = Number(rowKey);
          assertRowExists(table, rowId, present);
          writeValue(data, rowId, value);
        }
        table.data.set(column.id, data);
        columns.splice(inserted.index, 0, { ...column });
        const n = Number(/^c(\d+)$/.exec(column.id)?.[1] ?? '-1');
        maxCol = Math.max(maxCol, n + 1);
      }
      table.columns = columns;
      table.nextColId = maxCol;
      return { type: 'deleteColumns', tableId: table.id, colIds: sorted.map((c) => c.column.id) };
    }

    case 'deleteColumns': {
      const table = findTable(tables, effect.tableId);
      const remove = new Set(effect.colIds);
      for (const colId of remove) columnOf(table, colId);
      const removed: InsertedColumn[] = [];
      table.columns.forEach((column, index) => {
        if (!remove.has(column.id)) return;
        const data = columnOf(table, column.id);
        const cells: Record<string, CellValue> = {};
        for (const rowId of table.rowOrder) {
          const value = readValue(data, rowId);
          if (!isEmptyText(value)) cells[String(rowId)] = value;
        }
        removed.push(Object.keys(cells).length > 0 ? { column, index, cells } : { column, index });
      });
      table.columns = table.columns.filter((c) => !remove.has(c.id));
      for (const colId of remove) table.data.delete(colId);
      return { type: 'insertColumns', tableId: table.id, columns: removed };
    }

    case 'renameColumn': {
      const table = findTable(tables, effect.tableId);
      const index = table.columns.findIndex((c) => c.id === effect.colId);
      const column = table.columns[index];
      if (!column) throw new EffectError(`Coluna inexistente: ${effect.colId}`);
      const inverse: Effect = {
        type: 'renameColumn',
        tableId: table.id,
        colId: column.id,
        name: column.name,
        ...(column.path ? { path: [...column.path] } : {}),
      };
      const renamed: Column = { id: column.id, name: effect.name };
      if (effect.path) renamed.path = effect.path;
      // As ocorrências de chave repetida só valem para o caminho original.
      if (column.pathOccurrences && effect.path && column.path?.length === effect.path.length) {
        renamed.pathOccurrences = column.pathOccurrences;
      }
      table.columns = table.columns.map((c, i) => (i === index ? renamed : c));
      return inverse;
    }

    case 'batch': {
      const inverses: Effect[] = [];
      try {
        for (const inner of effect.effects) inverses.push(applyEffect(tables, inner));
      } catch (err) {
        // Tudo ou nada: desfaz o que já foi aplicado antes de propagar o erro.
        for (const inverse of inverses.reverse()) applyEffect(tables, inverse);
        throw err;
      }
      return { type: 'batch', effects: inverses.reverse() };
    }
  }
}

/** Mudanças de células que o efeito representa, para as marcas de alteração. */
export function forEachTouched(
  effect: Effect,
  visit: (touch: {
    tableId: string;
    cell?: { rowId: number; colId: string };
    rowId?: number;
    colId?: string;
  }) => void,
): void {
  switch (effect.type) {
    case 'setCells':
      for (const c of effect.cells)
        visit({ tableId: effect.tableId, cell: { rowId: c.rowId, colId: c.colId } });
      return;
    case 'insertRows':
      for (const r of effect.rows) visit({ tableId: effect.tableId, rowId: r.rowId });
      return;
    case 'insertColumns':
      for (const c of effect.columns) visit({ tableId: effect.tableId, colId: c.column.id });
      return;
    case 'renameColumn':
      visit({ tableId: effect.tableId, colId: effect.colId });
      return;
    case 'deleteRows':
    case 'deleteColumns':
      visit({ tableId: effect.tableId });
      return;
    case 'batch':
      for (const inner of effect.effects) forEachTouched(inner, visit);
  }
}
