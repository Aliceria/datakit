import {
  EMPTY_TEXT,
  ImportError,
  STATE_VALUE,
  parseTsv,
  planClear,
  planDeleteColumns,
  planDeleteRows,
  planInsertColumns,
  planInsertRows,
  planPaste,
  planRenameColumn,
  planSetNull,
  planSetText,
  readValue,
  toTsv,
  type CellValue,
  type PasteBlock,
  type Table,
} from '@datakit/core';
import { activeTable, appStore, showError, type Selection } from './appStore.ts';
import { execute } from './editor.ts';
import { clampSelection, normalized, selectedIds, setSelection } from './selection.ts';
import { hintPlacement, visibleRows } from './view.ts';

// Comandos da edição (seções 7.2 e 7.3), sobre a seleção da tabela ativa.

function context(): { table: Table; sel: Selection } | undefined {
  const state = appStore.get();
  const table = activeTable(state);
  if (!table || !state.selection || state.sessionStatus === 'expired') return undefined;
  return { table, sel: state.selection };
}

function selectedRefs(table: Table, sel: Selection) {
  const { rowIds, colIds } = selectedIds(sel, table);
  return rowIds.flatMap((rowId) => colIds.map((colId) => ({ rowId, colId })));
}

function guarded(run: () => void): void {
  try {
    run();
  } catch (err) {
    if (err instanceof ImportError) showError('Não é possível', err.message);
    else throw err;
  }
}

function afterStructureChange(): void {
  const state = appStore.get();
  const table = activeTable(state);
  if (state.selection && table) setSelection(clampSelection(state.selection, table));
}

// --- Células -----------------------------------------------------------------------------------

/** Confirma a edição de uma célula. Texto igual ao atual não gera operação. */
export function commitCellEdit(r: number, c: number, text: string): void {
  const table = activeTable(appStore.get());
  const rowId = table ? visibleRows(appStore.get(), table)[r] : undefined;
  const column = table?.columns[c];
  if (!table || rowId === undefined || !column) return;
  const data = table.data.get(column.id);
  const current = data ? readValue(data, rowId) : undefined;
  if (current?.s === STATE_VALUE && current.r === text) return;
  execute('Editar célula', planSetText(table, [{ rowId, colId: column.id }], text));
}

/** Delete: deixa as células selecionadas com texto vazio (seção 7.2). */
export function clearSelection(): void {
  const ctx = context();
  if (!ctx) return;
  execute('Limpar células', planClear(ctx.table, selectedRefs(ctx.table, ctx.sel)));
}

export function setSelectionNull(): void {
  const ctx = context();
  if (!ctx) return;
  execute('Definir como nulo', planSetNull(ctx.table, selectedRefs(ctx.table, ctx.sel)));
}

// --- Linhas e colunas --------------------------------------------------------------------------

export function insertRows(where: 'above' | 'below'): void {
  const ctx = context();
  if (!ctx) return;
  const { r1, r2 } = normalized(ctx.sel, ctx.table);
  const count = ctx.sel.mode === 'rows' ? r2 - r1 + 1 : 1;
  // Posição na vista (o que o usuário vê) e a posição correspondente na ordem dos dados.
  const index = where === 'above' ? r1 : r2 + 1;
  const view = visibleRows(appStore.get(), ctx.table);
  const anchorRow = where === 'above' ? view[r1] : view[r2];
  const anchorIndex = anchorRow === undefined ? -1 : ctx.table.rowOrder.indexOf(anchorRow);
  const dataIndex =
    anchorIndex < 0 ? ctx.table.rowOrder.length : where === 'above' ? anchorIndex : anchorIndex + 1;
  guarded(() => {
    const doc = appStore.get().doc;
    if (!doc) return;
    const label = count === 1 ? 'Inserir linha' : `Inserir ${String(count)} linhas`;
    const effect = planInsertRows(doc.tables, ctx.table, dataIndex, count);
    if (effect.type === 'insertRows')
      hintPlacement(
        effect.rows.map((r) => r.rowId),
        index,
      );
    if (execute(label, effect)) {
      setSelection({
        mode: 'rows',
        anchor: { r: index, c: 0 },
        focus: { r: index + count - 1, c: 0 },
      });
    }
  });
}

export function deleteRows(): void {
  const ctx = context();
  if (!ctx) return;
  const { rowIds } = selectedIds(ctx.sel, ctx.table);
  const label = rowIds.length === 1 ? 'Excluir linha' : `Excluir ${String(rowIds.length)} linhas`;
  if (execute(label, planDeleteRows(ctx.table, rowIds))) afterStructureChange();
}

export function insertColumns(where: 'left' | 'right'): void {
  const ctx = context();
  if (!ctx) return;
  const { c1, c2 } = normalized(ctx.sel, ctx.table);
  const count = ctx.sel.mode === 'columns' ? c2 - c1 + 1 : 1;
  const index = where === 'left' ? c1 : c2 + 1;
  guarded(() => {
    const doc = appStore.get().doc;
    if (!doc) return;
    const label = count === 1 ? 'Inserir coluna' : `Inserir ${String(count)} colunas`;
    if (execute(label, planInsertColumns(doc.tables, ctx.table, index, count))) {
      setSelection({
        mode: 'columns',
        anchor: { r: 0, c: index },
        focus: { r: 0, c: index + count - 1 },
      });
    }
  });
}

export function deleteColumns(): void {
  const ctx = context();
  if (!ctx) return;
  const { colIds } = selectedIds(ctx.sel, ctx.table);
  if (colIds.length >= ctx.table.columns.length) {
    showError('Não é possível', 'A tabela precisa ficar com pelo menos uma coluna.');
    return;
  }
  const label = colIds.length === 1 ? 'Excluir coluna' : `Excluir ${String(colIds.length)} colunas`;
  if (execute(label, planDeleteColumns(ctx.table, colIds))) afterStructureChange();
}

export function renameColumn(c: number, newName: string): boolean {
  const table = activeTable(appStore.get());
  const column = table?.columns[c];
  if (!table || !column) return false;
  if (newName.trim() === '') {
    showError('Nome inválido', 'O nome da coluna não pode ficar vazio.');
    return false;
  }
  const leaf = column.path ? column.path.at(-1) : column.name;
  if (leaf === newName) return true;
  return execute('Renomear coluna', planRenameColumn(table, column.id, newName));
}

// --- Área de transferência ---------------------------------------------------------------------

/** Cópia interna: preserva nulo, ausente e tipo nativo ao colar dentro do DataKit (L18). */
let internalClipboard: { text: string; cells: CellValue[][] } | undefined;

/** Texto TSV da seleção (seção 7.2). Nulo e ausente viram campo vazio. */
export function copySelection(): string | undefined {
  const ctx = context();
  if (!ctx) return undefined;
  const { rowIds, colIds } = selectedIds(ctx.sel, ctx.table);
  const cells = rowIds.map((rowId) =>
    colIds.map((colId) => {
      const data = ctx.table.data.get(colId);
      return data ? readValue(data, rowId) : EMPTY_TEXT;
    }),
  );
  const text = toTsv(cells.map((row) => row.map((v) => (v.s === STATE_VALUE ? (v.r ?? '') : ''))));
  internalClipboard = { text, cells };
  return text;
}

export function cutSelection(): string | undefined {
  const text = copySelection();
  const ctx = context();
  if (text !== undefined && ctx)
    execute('Recortar', planClear(ctx.table, selectedRefs(ctx.table, ctx.sel)));
  return text;
}

/**
 * Cola na seleção. Texto igual ao último copiado aqui usa os valores completos. Se o bloco
 * passar da borda, pergunta antes de criar linhas e colunas (L17).
 */
export function pasteText(text: string): void {
  const ctx = context();
  const doc = appStore.get().doc;
  if (!ctx || !doc) return;
  const block: PasteBlock =
    internalClipboard?.text === text
      ? { kind: 'cells', rows: internalClipboard.cells }
      : { kind: 'text', rows: parseTsv(text) };
  if (block.rows.length === 0) return;
  const range = normalized(ctx.sel, ctx.table);
  const target = {
    rowIndex: range.r1,
    colIndex: range.c1,
    rows: range.r2 - range.r1 + 1,
    cols: range.c2 - range.c1 + 1,
  };
  guarded(() => {
    const plan = planPaste(
      doc.tables,
      ctx.table,
      visibleRows(appStore.get(), ctx.table),
      target,
      block,
    );
    const apply = () => {
      // Linhas criadas além da borda aparecem no fim da vista, logo abaixo do que foi colado.
      const inserted =
        plan.effect.type === 'batch'
          ? plan.effect.effects.find((e) => e.type === 'insertRows')
          : undefined;
      if (inserted?.type === 'insertRows') {
        hintPlacement(
          inserted.rows.map((r) => r.rowId),
          visibleRows(appStore.get(), ctx.table).length,
        );
      }
      if (execute('Colar', plan.effect)) {
        const height = Math.max(target.rows, block.rows.length);
        const width = Math.max(
          target.cols,
          block.rows.reduce((m, r) => Math.max(m, r.length), 0),
        );
        setSelection({
          mode: 'cells',
          anchor: { r: target.rowIndex, c: target.colIndex },
          focus: { r: target.rowIndex + height - 1, c: target.colIndex + width - 1 },
        });
      }
    };
    if (plan.addedRows === 0 && plan.addedCols === 0) {
      apply();
      return;
    }
    const parts: string[] = [];
    if (plan.addedRows > 0)
      parts.push(`${String(plan.addedRows)} ${plan.addedRows === 1 ? 'linha' : 'linhas'}`);
    if (plan.addedCols > 0)
      parts.push(`${String(plan.addedCols)} ${plan.addedCols === 1 ? 'coluna' : 'colunas'}`);
    appStore.set({
      confirm: {
        title: 'Colar além da tabela',
        message: `O conteúdo colado passa da borda da tabela. Adicionar ${parts.join(' e ')}?`,
        confirmLabel: 'Adicionar e colar',
        onConfirm: () => {
          appStore.set({ confirm: undefined });
          apply();
        },
      },
    });
  });
}

/** "Colar" pelo menu: lê a área de transferência, se o navegador permitir. */
export async function pasteFromMenu(): Promise<void> {
  try {
    pasteText(await navigator.clipboard.readText());
  } catch {
    showError(
      'Colar pelo menu não foi permitido',
      'O navegador não liberou o acesso à área de transferência. Use Ctrl+V para colar.',
    );
  }
}

/** "Copiar" e "Recortar" pelo menu. Recortar só limpa depois que a cópia deu certo. */
export async function copyFromMenu(cut = false): Promise<void> {
  const text = copySelection();
  if (text === undefined) return;
  try {
    await navigator.clipboard.writeText(text);
    const ctx = cut ? context() : undefined;
    if (ctx) execute('Recortar', planClear(ctx.table, selectedRefs(ctx.table, ctx.sel)));
  } catch {
    showError(
      'Copiar pelo menu não foi permitido',
      'O navegador não liberou o acesso à área de transferência. Use Ctrl+C para copiar.',
    );
  }
}
