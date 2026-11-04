import {
  ANY_COLUMN,
  findDuplicateRows,
  findDuplicateRowsInSlices,
  findEmptyRows,
  formatInteger,
  planClearColumns,
  planConvertType,
  planDeleteRows,
  planFillEmpty,
  planReplaceValue,
  planTransform,
  type ConvertSource,
  type ConvertTarget,
  type Effect,
  type Table,
  type TextTransform,
} from '@datakit/core';
import { activeTable, appStore } from './appStore.ts';
import { execute } from './editor.ts';
import { selectedIds } from './selection.ts';
import { setColumnFilter, specOf, visibleRows } from './view.ts';

// Ferramentas de tratamento de dados (seção 8): o diálogo pede as opções e o escopo, mostra
// quantas linhas ou células mudam e executa uma operação só (um Ctrl+Z desfaz).

export type ToolKind =
  'duplicates' | 'emptyRows' | 'convert' | TextTransform | 'fill' | 'replaceValue' | 'clear';

export const TOOL_TITLES: Record<ToolKind, string> = {
  duplicates: 'Remover duplicadas',
  emptyRows: 'Remover linhas vazias',
  convert: 'Converter tipo',
  trim: 'Aparar espaços',
  upper: 'MAIÚSCULAS',
  lower: 'minúsculas',
  title: 'Primeira Letra Maiúscula',
  fill: 'Preencher vazios',
  replaceValue: 'Substituir valor',
  clear: 'Limpar coluna',
};

/** Ferramentas que atuam nas colunas selecionadas (as outras, na tabela). */
export const COLUMN_TOOLS: readonly ToolKind[] = [
  'convert',
  'trim',
  'upper',
  'lower',
  'title',
  'fill',
  'replaceValue',
  'clear',
];

export type ToolRequest = { kind: ToolKind; tableId: string; colIds: string[] };

export type ToolParams = {
  /** Remover duplicadas: colunas comparadas. */
  compare: string[];
  ignoreCase: boolean;
  trim: boolean;
  whitespaceAsEmpty: boolean;
  target: ConvertTarget;
  source: ConvertSource;
  value: string;
  from: string;
  to: string;
};

export type Scope = 'all' | 'visible';

export type ToolPreview = {
  effect: Effect;
  /** Quantas linhas (ferramentas de linha) ou células mudam. */
  count: number;
  unit: 'linhas' | 'células';
  /** Converter tipo: células que não puderam ser convertidas, por coluna. */
  failed?: Array<{ colId: string; rowIds: number[] }>;
};

function tableById(tableId: string): Table | undefined {
  return appStore.get().doc?.tables.find((t) => t.id === tableId);
}

/** Há filtro escondendo linhas? Só então o escopo é perguntado (seção 7.5). */
export function filterActive(tableId: string): boolean {
  return specOf(appStore.get(), tableId).filters.length > 0;
}

export function scopeRows(table: Table, scope: Scope): readonly number[] {
  return scope === 'visible' ? visibleRows(appStore.get(), table) : table.rowOrder;
}

/** Abre o diálogo da ferramenta para a tabela ativa e as colunas da seleção. */
export function openTool(kind: ToolKind): void {
  const state = appStore.get();
  const table = activeTable(state);
  if (!table) return;
  const colIds = state.selection ? selectedIds(state.selection, table).colIds : [];
  appStore.set({ tool: { kind, tableId: table.id, colIds } });
}

export function closeTool(): void {
  appStore.set({ tool: undefined });
}

export function previewTool(req: ToolRequest, params: ToolParams, scope: Scope): ToolPreview {
  const table = tableById(req.tableId);
  if (!table) return { effect: { type: 'batch', effects: [] }, count: 0, unit: 'células' };
  const rows = scopeRows(table, scope);
  const cols = req.colIds.filter((id) => table.data.has(id));
  switch (req.kind) {
    case 'duplicates': {
      // Mantém a primeira ocorrência na ordem dos dados, mesmo com ordenação na vista.
      const order = scope === 'visible' ? table.rowOrder.filter(inSet(rows)) : table.rowOrder;
      const dup = findDuplicateRows(table, order, params.compare, params);
      return { effect: planDeleteRows(table, dup), count: dup.length, unit: 'linhas' };
    }
    case 'emptyRows': {
      const empty = findEmptyRows(table, rows, params);
      return { effect: planDeleteRows(table, empty), count: empty.length, unit: 'linhas' };
    }
    case 'convert': {
      const effects: Effect[] = [];
      const failed: Array<{ colId: string; rowIds: number[] }> = [];
      let count = 0;
      for (const colId of cols) {
        const plan = planConvertType(table, colId, rows, params.target, params.source);
        effects.push(plan.effect);
        count += plan.converted;
        if (plan.failed.length > 0) failed.push({ colId, rowIds: plan.failed });
      }
      return { effect: batch(effects), count, unit: 'células', failed };
    }
    case 'trim':
    case 'upper':
    case 'lower':
    case 'title': {
      const plan = planTransform(table, cols, rows, req.kind);
      return { effect: plan.effect, count: plan.cells, unit: 'células' };
    }
    case 'fill': {
      const plan = planFillEmpty(table, cols, rows, params.value);
      return { effect: plan.effect, count: plan.cells, unit: 'células' };
    }
    case 'replaceValue': {
      const plan = planReplaceValue(table, cols, rows, params.from, params.to);
      return { effect: plan.effect, count: plan.cells, unit: 'células' };
    }
    case 'clear': {
      const plan = planClearColumns(table, cols, rows);
      return { effect: plan.effect, count: plan.cells, unit: 'células' };
    }
  }
}

const inSet = (rows: readonly number[]) => {
  const set = new Set(rows);
  return (rowId: number) => set.has(rowId);
};

export type ToolPreviews = { all: ToolPreview; visible: ToolPreview | undefined };

const yieldToUi = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Remover duplicadas, em fatias (seção 13): a interface não trava com 100.000 linhas. */
async function duplicatesAsync(
  table: Table,
  rows: readonly number[],
  params: ToolParams,
  cancelled: () => boolean,
): Promise<ToolPreview | undefined> {
  const steps = findDuplicateRowsInSlices(table, rows, params.compare, params);
  for (;;) {
    const step = steps.next();
    if (step.done) {
      return {
        effect: planDeleteRows(table, step.value),
        count: step.value.length,
        unit: 'linhas',
      };
    }
    await yieldToUi();
    if (cancelled()) return undefined;
  }
}

/**
 * Prévia para o diálogo: todas as linhas e, com filtro ativo, só as visíveis. Devolve undefined
 * se for cancelada (o usuário mudou uma opção no meio).
 */
export async function previewToolBoth(
  req: ToolRequest,
  params: ToolParams,
  withVisible: boolean,
  cancelled: () => boolean,
): Promise<ToolPreviews | undefined> {
  await yieldToUi();
  if (cancelled()) return undefined;
  const table = tableById(req.tableId);
  if (req.kind !== 'duplicates' || !table) {
    return {
      all: previewTool(req, params, 'all'),
      visible: withVisible ? previewTool(req, params, 'visible') : undefined,
    };
  }
  const all = await duplicatesAsync(table, table.rowOrder, params, cancelled);
  if (!all) return undefined;
  if (!withVisible) return { all, visible: undefined };
  const order = table.rowOrder.filter(inSet(scopeRows(table, 'visible')));
  const visible = await duplicatesAsync(table, order, params, cancelled);
  return visible ? { all, visible } : undefined;
}

function batch(effects: Effect[]): Effect {
  return effects.length === 1 ? (effects[0] as Effect) : { type: 'batch', effects };
}

export function runTool(req: ToolRequest, preview: ToolPreview): void {
  if (preview.count === 0) return;
  if (!execute(req.kind, TOOL_TITLES[req.kind], preview.effect)) return;
  const failed = preview.failed ?? [];
  const failedCount = failed.reduce((n, f) => n + f.rowIds.length, 0);
  appStore.set({
    tool: undefined,
    flagged:
      failedCount > 0
        ? {
            tableId: req.tableId,
            cells: new Set(failed.flatMap((f) => f.rowIds.map((r) => `${String(r)}:${f.colId}`))),
          }
        : undefined,
  });
  if (failedCount > 0) {
    appStore.set({
      message: {
        title: 'Conversão concluída',
        tone: 'warning',
        lines: [
          `${formatInteger(failedCount)} valores não puderam ser convertidos e ficaram como estavam, destacados na grade.`,
          'Dá para desfazer com Ctrl+Z.',
        ],
      },
    });
  }
}

// --- Localizar: filtros prontos (seção 8) ----------------------------------------------------

/** Localizar vazios: na coluna dada, ou em qualquer coluna da tabela. */
export function locateBlanks(tableId: string, colId: string | undefined): void {
  setColumnFilter(tableId, colId ?? ANY_COLUMN, { kind: 'state', op: 'blank' });
}

/** Identificar inconsistentes: linhas com algum valor inconsistente (seção 4.2). */
export function identifyInconsistent(tableId: string): void {
  setColumnFilter(tableId, ANY_COLUMN, { kind: 'state', op: 'inconsistent' });
}
