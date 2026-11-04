// Histórico de desfazer/refazer e marcas de alteração (seção 4.3, docs/PLANO.md 4.4).
// O log de operações guarda edições, "desfazer" e "refazer". Reaplicar o mesmo log, no navegador
// ou no servidor, reconstrói exatamente o mesmo histórico: as funções daqui são a única fonte.

import { LIMITS } from '../params.ts';
import type { Table } from '../model/table.ts';
import { applyEffect, forEachTouched, type Effect } from './effects.ts';

/** Teto de tamanho do histórico, além das 100 operações (L16), em caracteres de JSON. */
export const HISTORY_MAX_CHARS = 64 * 1024 * 1024;

export type HistoryEntry = {
  opId: string;
  label: string;
  effect: Effect;
  inverse: Effect;
  /** Tamanho aproximado (JSON do efeito + do inverso), para o teto de memória. */
  size: number;
};

export type History = { undo: HistoryEntry[]; redo: HistoryEntry[] };

/** Marcas de alteração por tabela (seção 7.1). Somem quando a tabela é exportada inteira (L19). */
export type TableMarks = { cells: Set<string>; rows: Set<number>; cols: Set<string> };

export type Marks = {
  /** Operações aplicadas desde a importação ou a última exportação. */
  changes: number;
  tables: Map<string, TableMarks>;
};

export type EditorState = { tables: Table[]; history: History; marks: Marks };

/**
 * Ferramenta que gerou uma edição. Lista fechada, validada no servidor; serve só para as métricas
 * de uso (quais funcionalidades as pessoas usam). Operações antigas não têm o campo.
 */
export const EDIT_TOOLS = [
  'editCell',
  'clearCells',
  'setNull',
  'cut',
  'paste',
  'insertRows',
  'deleteRows',
  'insertColumns',
  'deleteColumns',
  'renameColumn',
  'applyOrder',
  'replace',
  'replaceAll',
  'duplicates',
  'emptyRows',
  'convert',
  'trim',
  'upper',
  'lower',
  'title',
  'fill',
  'replaceValue',
  'clear',
] as const;

export type EditTool = (typeof EDIT_TOOLS)[number];

export type LogOp = { seq: number; opId: string } & (
  | { kind: 'edit'; label: string; effect: Effect; tool?: EditTool }
  | { kind: 'undo' }
  | { kind: 'redo' }
  /** Exportação completa dessas tabelas: limpa as marcas delas (não entra no histórico). */
  | { kind: 'exported'; tableIds: string[] }
);

export const cellKey = (rowId: number, colId: string): string => `${String(rowId)}:${colId}`;

export function emptyHistory(): History {
  return { undo: [], redo: [] };
}

export function emptyMarks(): Marks {
  return { changes: 0, tables: new Map() };
}

function tableMarks(marks: Marks, tableId: string): TableMarks {
  let entry = marks.tables.get(tableId);
  if (!entry) {
    entry = { cells: new Set(), rows: new Set(), cols: new Set() };
    marks.tables.set(tableId, entry);
  }
  return entry;
}

function mark(marks: Marks, effect: Effect): void {
  marks.changes += 1;
  forEachTouched(effect, (touch) => {
    const entry = tableMarks(marks, touch.tableId);
    if (touch.cell) entry.cells.add(cellKey(touch.cell.rowId, touch.cell.colId));
    if (touch.rowId !== undefined) entry.rows.add(touch.rowId);
    if (touch.colId !== undefined) entry.cols.add(touch.colId);
  });
}

const historySize = (h: History): number =>
  h.undo.reduce((s, e) => s + e.size, 0) + h.redo.reduce((s, e) => s + e.size, 0);

/** Remove as entradas mais antigas até caber nos limites (100 operações e o teto de tamanho). */
function trim(history: History): void {
  while (history.undo.length > LIMITS.undoHistoryOps) history.undo.shift();
  while (history.undo.length > 0 && historySize(history) > HISTORY_MAX_CHARS) history.undo.shift();
}

export class HistoryError extends Error {}

/** Aplica uma operação do log. Lança erro se ela não puder ser aplicada (nada muda nesse caso). */
export function applyLogOp(state: EditorState, op: LogOp): void {
  const { history } = state;
  if (op.kind === 'exported') {
    for (const id of op.tableIds) state.marks.tables.delete(id);
    // O contador de alterações não exportadas zera quando nenhuma tabela tem marca.
    const pending = [...state.marks.tables.values()].some(
      (m) => m.cells.size + m.rows.size + m.cols.size > 0,
    );
    if (!pending) state.marks.changes = 0;
    return;
  }
  if (op.kind === 'edit') {
    const inverse = applyEffect(state.tables, op.effect);
    const size = JSON.stringify(op.effect).length + JSON.stringify(inverse).length;
    history.undo.push({ opId: op.opId, label: op.label, effect: op.effect, inverse, size });
    history.redo = [];
    trim(history);
    mark(state.marks, op.effect);
    return;
  }
  if (op.kind === 'undo') {
    const entry = history.undo.pop();
    if (!entry) throw new HistoryError('Nada para desfazer');
    try {
      applyEffect(state.tables, entry.inverse);
    } catch (err) {
      history.undo.push(entry);
      throw err;
    }
    history.redo.push(entry);
    mark(state.marks, entry.inverse);
    return;
  }
  const entry = history.redo.pop();
  if (!entry) throw new HistoryError('Nada para refazer');
  try {
    applyEffect(state.tables, entry.effect);
  } catch (err) {
    history.redo.push(entry);
    throw err;
  }
  history.undo.push(entry);
  trim(history);
  mark(state.marks, entry.effect);
}

// --- Serialização (manifesto do snapshot) -------------------------------------------------------

export type SerializedMarks = {
  changes: number;
  tables: Record<string, { cells: string[]; rows: number[]; cols: string[] }>;
};

export function serializeMarks(marks: Marks): SerializedMarks {
  const tables: SerializedMarks['tables'] = {};
  for (const [id, m] of marks.tables) {
    tables[id] = { cells: [...m.cells], rows: [...m.rows], cols: [...m.cols] };
  }
  return { changes: marks.changes, tables };
}

export function deserializeMarks(data: SerializedMarks | undefined): Marks {
  const marks = emptyMarks();
  if (!data) return marks;
  marks.changes = data.changes;
  for (const [id, m] of Object.entries(data.tables)) {
    marks.tables.set(id, { cells: new Set(m.cells), rows: new Set(m.rows), cols: new Set(m.cols) });
  }
  return marks;
}
