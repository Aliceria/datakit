import {
  ImportError,
  applyLogOp,
  createStatsAccumulator,
  forEachTouched,
  inferColumn,
  type ColumnInference,
  type Effect,
  type LogOp,
} from '@datakit/core';
import { enqueue, nextSeq } from '../session/opQueue.ts';
import { appStore, showError } from './appStore.ts';
import { adjustViews } from './view.ts';

function tablesOf(effect: Effect): Set<string> {
  const ids = new Set<string>();
  forEachTouched(effect, (t) => ids.add(t.tableId));
  return ids;
}

// Controlador do documento: o único caminho para alterar dados no navegador. Aplica a operação
// localmente com o core (resposta imediata) e a põe na fila para o servidor (seção 4.1).

function bump(): void {
  appStore.set((s) => ({ revision: s.revision + 1 }));
}

/** O que precisa ser recalculado: por tabela, as colunas tocadas ("all" = todas). */
type Dirty = Map<string, Set<string> | 'all'>;
const dirty: Dirty = new Map();

function markDirty(effect: Effect): void {
  forEachTouched(effect, (touch) => {
    const current = dirty.get(touch.tableId);
    if (current === 'all') return;
    // Linhas inseridas ou excluídas mudam todas as colunas; células e colunas novas, só elas.
    const column = touch.cell?.colId ?? touch.colId;
    if (column === undefined) {
      dirty.set(touch.tableId, 'all');
      return;
    }
    const set = current ?? new Set<string>();
    set.add(column);
    dirty.set(touch.tableId, set);
  });
}

function run(op: LogOp, effect: Effect): boolean {
  const { doc, sessionStatus } = appStore.get();
  if (!doc || sessionStatus === 'expired') return false;
  try {
    applyLogOp(doc, op);
  } catch (err) {
    showError(
      'Não foi possível aplicar a alteração',
      err instanceof ImportError
        ? err.message
        : 'A alteração não pôde ser aplicada aos dados atuais.',
    );
    return false;
  }
  enqueue(op);
  markDirty(effect);
  adjustViews(tablesOf(effect));
  scheduleDerived();
  bump();
  return true;
}

/** Executa uma edição (uma entrada no histórico, mesmo que seja em massa). */
export function execute(label: string, effect: Effect): boolean {
  return run({ seq: nextSeq(), opId: crypto.randomUUID(), kind: 'edit', label, effect }, effect);
}

export function undo(): void {
  const entry = appStore.get().doc?.history.undo.at(-1);
  if (!entry) return;
  run({ seq: nextSeq(), opId: crypto.randomUUID(), kind: 'undo' }, entry.inverse);
}

export function redo(): void {
  const entry = appStore.get().doc?.history.redo.at(-1);
  if (!entry) return;
  run({ seq: nextSeq(), opId: crypto.randomUUID(), kind: 'redo' }, entry.effect);
}

/** Reaplica operações guardadas (fila do sessionStorage) depois de carregar do servidor. */
export function replayPending(ops: readonly LogOp[]): number {
  const { doc } = appStore.get();
  if (!doc) return 0;
  let applied = 0;
  for (const op of ops) {
    try {
      applyLogOp(doc, op);
      applied += 1;
    } catch {
      break;
    }
  }
  for (const table of doc.tables) dirty.set(table.id, 'all');
  adjustViews(doc.tables.map((t) => t.id));
  scheduleDerived();
  return applied;
}

// --- Estatísticas e inferência (seção 9) -------------------------------------------------------
// Recalculadas com debounce e em fatias, devolvendo o controle à interface entre uma fatia e
// outra: num arquivo de 100.000 linhas, o cálculo inteiro levaria ~0,7 s de tela travada.
// A inferência é refeita só nas colunas tocadas. Uma operação nova no meio recomeça o cálculo.

const DERIVED_DEBOUNCE_MS = 400;
const SLICE_ROWS = 5000;
let derivedTimer: ReturnType<typeof setTimeout> | undefined;
let generation = 0;

const yieldToUi = () => new Promise((resolve) => setTimeout(resolve, 0));

function scheduleDerived(): void {
  generation += 1;
  if (derivedTimer !== undefined) clearTimeout(derivedTimer);
  derivedTimer = setTimeout(() => {
    derivedTimer = undefined;
    void recomputeDerived(generation);
  }, DERIVED_DEBOUNCE_MS);
}

async function recomputeDerived(gen: number): Promise<void> {
  const { doc } = appStore.get();
  if (!doc || dirty.size === 0) return;
  const work = [...dirty];
  for (const [tableId, columns] of work) {
    const table = doc.tables.find((t) => t.id === tableId);
    if (!table) {
      dirty.delete(tableId);
      continue;
    }
    const stats = createStatsAccumulator(table);
    for (let i = 0; i < table.rowOrder.length; i += SLICE_ROWS) {
      stats.addRows(table.rowOrder.slice(i, i + SLICE_ROWS));
      await yieldToUi();
      if (gen !== generation) return;
    }

    const inference: Record<string, ColumnInference> = { ...doc.inference[tableId] };
    for (const column of table.columns) {
      if (columns !== 'all' && !columns.has(column.id) && inference[column.id]) continue;
      const data = table.data.get(column.id);
      if (data) inference[column.id] = inferColumn(data, table.rowOrder);
      await yieldToUi();
      if (gen !== generation) return;
    }
    // Colunas excluídas saem da inferência.
    const current = Object.fromEntries(
      Object.entries(inference).filter(([id]) => table.data.has(id)),
    );

    doc.stats[tableId] = stats.result();
    doc.inference[tableId] = current;
    dirty.delete(tableId);
  }
  bump();
}
