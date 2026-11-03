import {
  NATIVE,
  STATE_VALUE,
  type CellExtras,
  type CellState,
  type CellView,
  type NativeCode,
} from './cell.ts';

export type Column = {
  /** ID estável; não é o nome (nomes podem se repetir ou mudar). */
  id: string;
  name: string;
  /** Caminho original de chaves, para colunas vindas de JSON aninhado. */
  path?: readonly string[];
  /** Ocorrência de cada chave do caminho quando o objeto JSON tinha chave repetida (0 = primeira). */
  pathOccurrences?: readonly number[];
};

/** Células de uma coluna, indexadas pelo ID da linha (IDs são inteiros densos). */
export type ColumnData = {
  raw: (string | undefined)[];
  state: Uint8Array;
  native: Uint8Array;
  extras: Map<number, CellExtras>;
};

export type Table = {
  id: string;
  name: string;
  /** Aba oculta no XLSX de origem. */
  hidden: boolean;
  columns: Column[];
  data: Map<string, ColumnData>;
  /** Ordem atual das linhas, por ID. */
  rowOrder: number[];
  nextRowId: number;
  nextColId: number;
};

export function createColumnData(capacity: number, defaultState: CellState): ColumnData {
  const state = new Uint8Array(capacity);
  if (defaultState !== STATE_VALUE) state.fill(defaultState);
  const raw: (string | undefined)[] = new Array<string | undefined>(capacity);
  if (defaultState === STATE_VALUE) raw.fill('');
  return { raw, state, native: new Uint8Array(capacity), extras: new Map() };
}

/**
 * Cria uma tabela com `rowCount` linhas (IDs 0..rowCount-1) e as colunas informadas.
 * Toda célula começa no estado padrão: texto vazio (CSV, XLSX) ou ausente (JSON).
 */
export function createTable(params: {
  id: string;
  name: string;
  hidden?: boolean;
  columns: ReadonlyArray<Omit<Column, 'id'>>;
  rowCount: number;
  defaultState: CellState;
}): Table {
  const columns: Column[] = params.columns.map((c, i) => ({ ...c, id: `c${i}` }));
  const data = new Map<string, ColumnData>();
  for (const column of columns) {
    data.set(column.id, createColumnData(params.rowCount, params.defaultState));
  }
  return {
    id: params.id,
    name: params.name,
    hidden: params.hidden ?? false,
    columns,
    data,
    rowOrder: Array.from({ length: params.rowCount }, (_, i) => i),
    nextRowId: params.rowCount,
    nextColId: columns.length,
  };
}

export function columnData(table: Table, columnId: string): ColumnData {
  const data = table.data.get(columnId);
  if (!data) throw new Error(`Coluna inexistente: ${columnId}`);
  return data;
}

export function setCell(
  data: ColumnData,
  rowId: number,
  state: CellState,
  raw: string,
  native: NativeCode = NATIVE.none,
  extras?: CellExtras,
): void {
  data.state[rowId] = state;
  data.raw[rowId] = state === STATE_VALUE ? raw : undefined;
  data.native[rowId] = native;
  if (extras) data.extras.set(rowId, extras);
  else data.extras.delete(rowId);
}

export function readCell(data: ColumnData, rowId: number): CellView {
  const state = (data.state[rowId] ?? STATE_VALUE) as CellState;
  return {
    state,
    raw: state === STATE_VALUE ? (data.raw[rowId] ?? '') : '',
    native: (data.native[rowId] ?? NATIVE.none) as NativeCode,
    extras: data.extras.get(rowId),
  };
}

export function cellCount(table: Table): number {
  return table.rowOrder.length * table.columns.length;
}
