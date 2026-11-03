// Planejadores: transformam o pedido do usuário num efeito resolvido (docs/PLANO.md, 2.2).
// Rodam só no navegador; o servidor recebe o efeito pronto. Conferem os limites da seção 0
// também para edições (L17) e nunca mudam um texto além do que o usuário pediu.

import { ImportError } from '../errors.ts';
import { formatInteger } from '../format/numbers.ts';
import { STATE_VALUE, type NativeCode } from '../model/cell.ts';
import type { Column, Table } from '../model/table.ts';
import { LIMITS } from '../params.ts';
import { readValue, type CellChange, type CellValue, type Effect, NULL_VALUE } from './effects.ts';
import { nativeAfterEdit, predominantNative } from './nativeType.ts';

export type CellRef = { rowId: number; colId: string };

function columnNatives(table: Table, colIds: Iterable<string>): Map<string, NativeCode> {
  const map = new Map<string, NativeCode>();
  for (const colId of colIds) {
    const data = table.data.get(colId);
    if (data) map.set(colId, predominantNative(data, table.rowOrder));
  }
  return map;
}

/** Valor digitado: texto com o tipo nativo que a regra de compatibilidade permitir. */
function typedValue(table: Table, ref: CellRef, raw: string, colNative: NativeCode): CellValue {
  const data = table.data.get(ref.colId);
  const previous = data ? readValue(data, ref.rowId).t : 0;
  return { s: STATE_VALUE, r: raw, t: nativeAfterEdit(previous, raw, colNative) };
}

export function planSetText(table: Table, refs: readonly CellRef[], raw: string): Effect {
  const natives = columnNatives(table, new Set(refs.map((r) => r.colId)));
  return {
    type: 'setCells',
    tableId: table.id,
    cells: refs.map((ref) => ({
      ...ref,
      value: typedValue(table, ref, raw, natives.get(ref.colId) ?? 0),
    })),
  };
}

/** Delete: texto vazio (seção 7.2). */
export function planClear(table: Table, refs: readonly CellRef[]): Effect {
  return planSetText(table, refs, '');
}

export function planSetNull(table: Table, refs: readonly CellRef[]): Effect {
  return {
    type: 'setCells',
    tableId: table.id,
    cells: refs.map((ref) => ({ ...ref, value: NULL_VALUE })),
  };
}

// --- Limites -----------------------------------------------------------------------------------

export function assertEditLimits(
  tables: readonly Table[],
  change: { tableId: string; rows?: number; cols?: number },
) {
  let cells = 0;
  for (const t of tables) {
    const rows = t.rowOrder.length + (t.id === change.tableId ? (change.rows ?? 0) : 0);
    const cols = t.columns.length + (t.id === change.tableId ? (change.cols ?? 0) : 0);
    if (t.id === change.tableId) {
      if (rows > LIMITS.maxRowsPerTable) {
        throw new ImportError(
          'LIMIT_EXCEEDED',
          `A tabela ficaria com ${formatInteger(rows)} linhas; o limite é ${formatInteger(LIMITS.maxRowsPerTable)}.`,
        );
      }
      if (cols > LIMITS.maxColumnsPerTable) {
        throw new ImportError(
          'LIMIT_EXCEEDED',
          `A tabela ficaria com ${formatInteger(cols)} colunas; o limite é ${formatInteger(LIMITS.maxColumnsPerTable)}.`,
        );
      }
    }
    cells += rows * cols;
  }
  if (cells > LIMITS.maxCellsPerFile) {
    throw new ImportError(
      'LIMIT_EXCEEDED',
      `O arquivo ficaria com ${formatInteger(cells)} células; o limite é ${formatInteger(LIMITS.maxCellsPerFile)}.`,
    );
  }
}

// --- Linhas e colunas --------------------------------------------------------------------------

/** Insere `count` linhas vazias na posição `index` da ordem das linhas. */
export function planInsertRows(
  tables: readonly Table[],
  table: Table,
  index: number,
  count: number,
): Effect {
  assertEditLimits(tables, { tableId: table.id, rows: count });
  return {
    type: 'insertRows',
    tableId: table.id,
    rows: Array.from({ length: count }, (_, i) => ({
      rowId: table.nextRowId + i,
      index: index + i,
    })),
  };
}

export function planDeleteRows(table: Table, rowIds: readonly number[]): Effect {
  return { type: 'deleteRows', tableId: table.id, rowIds: [...rowIds] };
}

/** Próximo nome livre do tipo coluna_N. */
function freeColumnName(existing: Set<string>, start: number): [string, number] {
  let n = start;
  while (existing.has(`coluna_${String(n)}`)) n += 1;
  return [`coluna_${String(n)}`, n + 1];
}

export function planInsertColumns(
  tables: readonly Table[],
  table: Table,
  index: number,
  count: number,
): Effect {
  assertEditLimits(tables, { tableId: table.id, cols: count });
  const names = new Set(table.columns.map((c) => c.name));
  const usesPaths = table.columns.some((c) => c.path !== undefined);
  // Mesmo padrão dos cabeçalhos vazios (seção 6.1): coluna_N, com N = posição.
  let next = index + 1;
  const columns = Array.from({ length: count }, (_, i) => {
    const [name, after] = freeColumnName(names, next);
    next = after;
    names.add(name);
    const column: Column = { id: `c${String(table.nextColId + i)}`, name };
    if (usesPaths) column.path = [name];
    return { column, index: index + i };
  });
  return { type: 'insertColumns', tableId: table.id, columns };
}

export function planDeleteColumns(table: Table, colIds: readonly string[]): Effect {
  return { type: 'deleteColumns', tableId: table.id, colIds: [...colIds] };
}

/**
 * Renomear (seção 7.3). Em colunas vindas de JSON aninhado, o nome digitado troca só a última
 * chave do caminho (L22); o prefixo continua.
 */
export function planRenameColumn(table: Table, colId: string, newName: string): Effect {
  const column = table.columns.find((c) => c.id === colId);
  if (!column) throw new Error(`Coluna inexistente: ${colId}`);
  if (column.path) {
    const path = [...column.path.slice(0, -1), newName];
    return { type: 'renameColumn', tableId: table.id, colId, name: path.join('.'), path };
  }
  return { type: 'renameColumn', tableId: table.id, colId, name: newName };
}

// --- Colar -------------------------------------------------------------------------------------

/** Bloco colado: texto (de fora) ou valores completos (copiados do próprio DataKit — L18). */
export type PasteBlock =
  { kind: 'text'; rows: string[][] } | { kind: 'cells'; rows: CellValue[][] };

export type PastePlan = {
  effect: Effect;
  /** Linhas e colunas que precisaram ser criadas além da borda da tabela. */
  addedRows: number;
  addedCols: number;
  cellCount: number;
};

/**
 * Cola a partir da célula (rowIndex, colIndex) da ordem visível. Se o bloco passar da borda,
 * cria as linhas e colunas que faltarem (o chamador pede confirmação antes — L17).
 * Um bloco de uma célula numa seleção maior preenche a seleção inteira.
 */
export function planPaste(
  tables: readonly Table[],
  table: Table,
  visibleRowIds: readonly number[],
  target: { rowIndex: number; colIndex: number; rows: number; cols: number },
  block: PasteBlock,
): PastePlan {
  const height = block.rows.length;
  const width = block.rows.reduce((m, r) => Math.max(m, r.length), 0);
  const fill = height === 1 && width === 1 && (target.rows > 1 || target.cols > 1);
  const rows = fill ? target.rows : height;
  const cols = fill ? target.cols : width;

  const addedRows = Math.max(0, target.rowIndex + rows - visibleRowIds.length);
  const addedCols = Math.max(0, target.colIndex + cols - table.columns.length);
  const effects: Effect[] = [];
  const insertedRowIds: number[] = [];
  let colIds = table.columns.map((c) => c.id);

  if (addedRows > 0) {
    const insert = planInsertRows(tables, table, table.rowOrder.length, addedRows);
    effects.push(insert);
    if (insert.type === 'insertRows') insertedRowIds.push(...insert.rows.map((r) => r.rowId));
  }
  if (addedCols > 0) {
    assertEditLimits(tables, { tableId: table.id, rows: addedRows, cols: addedCols });
    const insert = planInsertColumns(tables, table, table.columns.length, addedCols);
    effects.push(insert);
    if (insert.type === 'insertColumns')
      colIds = [...colIds, ...insert.columns.map((c) => c.column.id)];
  }

  const targetRows = [...visibleRowIds, ...insertedRowIds];
  const natives = columnNatives(table, colIds);
  const present = new Set(table.rowOrder);
  const known = new Set(table.columns.map((c) => c.id));
  const cells: CellChange[] = [];
  for (let r = 0; r < rows; r += 1) {
    const rowId = targetRows[target.rowIndex + r];
    if (rowId === undefined) continue;
    const source = block.rows[fill ? 0 : r] ?? [];
    for (let c = 0; c < cols; c += 1) {
      const colId = colIds[target.colIndex + c];
      if (colId === undefined) continue;
      const item = source[fill ? 0 : c];
      let value: CellValue;
      if (block.kind === 'cells') {
        value = (item as CellValue | undefined) ?? { s: STATE_VALUE, r: '', t: 0 };
      } else {
        const raw = (item as string | undefined) ?? '';
        // Células novas (fora da tabela) ainda não existem para ler o tipo anterior.
        const existing = known.has(colId) && present.has(rowId);
        value = existing
          ? typedValue(table, { rowId, colId }, raw, natives.get(colId) ?? 0)
          : { s: STATE_VALUE, r: raw, t: 0 };
      }
      cells.push({ rowId, colId, value });
    }
  }
  effects.push({ type: 'setCells', tableId: table.id, cells });
  return {
    effect: effects.length === 1 ? (effects[0] as Effect) : { type: 'batch', effects },
    addedRows,
    addedCols,
    cellCount: cells.length,
  };
}

/** "Aplicar ordem atual aos dados" (seção 7.4): grava a ordem resolvida, que pode ser desfeita. */
export function planApplyOrder(table: Table, order: readonly number[]): Effect {
  return { type: 'reorderRows', tableId: table.id, order: [...order] };
}

/** Textos diferentes por célula numa operação só (ex.: "substituir todas"), com o tipo nativo de cada uma. */
export function planSetTexts(
  table: Table,
  items: ReadonlyArray<CellRef & { raw: string }>,
): Effect {
  const natives = columnNatives(table, new Set(items.map((i) => i.colId)));
  return {
    type: 'setCells',
    tableId: table.id,
    cells: items.map(({ rowId, colId, raw }) => ({
      rowId,
      colId,
      value: typedValue(table, { rowId, colId }, raw, natives.get(colId) ?? 0),
    })),
  };
}
