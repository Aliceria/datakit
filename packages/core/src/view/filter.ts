// Filtros por coluna (seção 7.4). Filtros de colunas diferentes se combinam com E.
// Só mudam a visualização: nunca alteram dados.

import { isInconsistent, type ColumnInference } from '../infer/classify.ts';
import { dateSortKey, parseDate } from '../infer/date.ts';
import { toCanonicalNumber } from '../infer/number.ts';
import { STATE_ABSENT, STATE_NULL, STATE_VALUE } from '../model/cell.ts';
import type { Table } from '../model/table.ts';
import { compareDecimal, parseDecimal, type Decimal } from '../util/decimal.ts';
import { TEXT_INFERENCE, cellFacts } from './facts.ts';

export type TextOp = 'contains' | 'notContains' | 'equals' | 'startsWith' | 'endsWith';
export type NumberOp = 'eq' | 'ne' | 'gt' | 'ge' | 'lt' | 'le' | 'between';
export type DateOp = 'before' | 'after' | 'between';
export type StateOp =
  'empty' | 'null' | 'absent' | 'notEmpty' | 'isNumber' | 'isText' | 'isDate' | 'inconsistent';

export type FilterCondition =
  | { kind: 'text'; op: TextOp; value: string; caseSensitive: boolean }
  | { kind: 'number'; op: NumberOp; value: string; value2?: string }
  | { kind: 'date'; op: DateOp; value: string; value2?: string }
  | { kind: 'state'; op: StateOp };

export type ColumnFilter = { colId: string; condition: FilterCondition };

export class FilterError extends Error {}

export const TEXT_OP_LABELS: Record<TextOp, string> = {
  contains: 'contém',
  notContains: 'não contém',
  equals: 'igual a',
  startsWith: 'começa com',
  endsWith: 'termina com',
};
export const NUMBER_OP_LABELS: Record<NumberOp, string> = {
  eq: '=',
  ne: '≠',
  gt: '>',
  ge: '≥',
  lt: '<',
  le: '≤',
  between: 'entre',
};
export const DATE_OP_LABELS: Record<DateOp, string> = {
  before: 'antes de',
  after: 'depois de',
  between: 'entre',
};
export const STATE_OP_LABELS: Record<StateOp, string> = {
  empty: 'é vazio',
  null: 'é nulo',
  absent: 'é ausente',
  notEmpty: 'não é vazio',
  isNumber: 'é número',
  isText: 'é texto',
  isDate: 'é data',
  inconsistent: 'é inconsistente',
};

/** Número digitado no filtro: no formato da coluna e, se não der, no outro. */
function parseNumberInput(text: string, info: ColumnInference): Decimal {
  const trimmed = text.trim();
  const other = info.numberLocale === 'br' ? 'intl' : 'br';
  const canonical =
    toCanonicalNumber(trimmed, info.numberLocale) ??
    toCanonicalNumber(trimmed, other) ??
    // Zeros à esquerda e números puros também valem como valor de filtro.
    (/^[+-]?\d+$/.test(trimmed) ? trimmed : undefined);
  const decimal = canonical === undefined ? undefined : parseDecimal(canonical);
  if (!decimal) throw new FilterError(`"${text}" não é um número válido.`);
  return decimal;
}

function parseDateInput(text: string): number {
  const parsed = parseDate(text.trim());
  if (!parsed)
    throw new FilterError(`"${text}" não é uma data válida (use dd/mm/aaaa ou aaaa-mm-dd).`);
  return dateSortKey(parsed.parts);
}

const lower = (s: string) => s.toLocaleLowerCase('pt-BR');

/** Compila o filtro num teste por ID de linha. Valores inválidos lançam FilterError. */
export function compileFilter(
  table: Table,
  filter: ColumnFilter,
  inference: Record<string, ColumnInference>,
): (rowId: number) => boolean {
  const data = table.data.get(filter.colId);
  if (!data) return () => true;
  const info = inference[filter.colId] ?? TEXT_INFERENCE;
  const c = filter.condition;

  switch (c.kind) {
    case 'text': {
      const needle = c.caseSensitive ? c.value : lower(c.value);
      return (rowId) => {
        const raw = data.state[rowId] === STATE_VALUE ? (data.raw[rowId] ?? '') : '';
        const hay = c.caseSensitive ? raw : lower(raw);
        switch (c.op) {
          case 'contains':
            return hay.includes(needle);
          case 'notContains':
            return !hay.includes(needle);
          case 'equals':
            return hay === needle;
          case 'startsWith':
            return hay.startsWith(needle);
          case 'endsWith':
            return hay.endsWith(needle);
        }
      };
    }
    case 'number': {
      const a = parseNumberInput(c.value, info);
      const b = c.op === 'between' ? parseNumberInput(c.value2 ?? '', info) : undefined;
      return (rowId) => {
        const d = cellFacts(data, rowId, info).decimal;
        if (!d) return false;
        const cmp = compareDecimal(d, a);
        switch (c.op) {
          case 'eq':
            return cmp === 0;
          case 'ne':
            return cmp !== 0;
          case 'gt':
            return cmp > 0;
          case 'ge':
            return cmp >= 0;
          case 'lt':
            return cmp < 0;
          case 'le':
            return cmp <= 0;
          case 'between': {
            if (!b) return false;
            const [lo, hi] = compareDecimal(a, b) <= 0 ? [a, b] : [b, a];
            return compareDecimal(d, lo) >= 0 && compareDecimal(d, hi) <= 0;
          }
        }
      };
    }
    case 'date': {
      const a = parseDateInput(c.value);
      const b = c.op === 'between' ? parseDateInput(c.value2 ?? '') : undefined;
      return (rowId) => {
        const key = cellFacts(data, rowId, info).dateKey;
        if (key === undefined) return false;
        if (c.op === 'before') return key < a;
        if (c.op === 'after') return key > a;
        if (b === undefined) return false;
        return key >= Math.min(a, b) && key <= Math.max(a, b);
      };
    }
    case 'state':
      return (rowId) => {
        const state = data.state[rowId];
        const raw = state === STATE_VALUE ? (data.raw[rowId] ?? '') : '';
        switch (c.op) {
          case 'empty':
            return state === STATE_VALUE && raw.trim() === '';
          case 'null':
            return state === STATE_NULL;
          case 'absent':
            return state === STATE_ABSENT;
          case 'notEmpty':
            return state === STATE_VALUE && raw.trim() !== '';
          case 'isNumber':
            return cellFacts(data, rowId, info).value.kind === 'number';
          case 'isText':
            return cellFacts(data, rowId, info).value.kind === 'text';
          case 'isDate':
            return cellFacts(data, rowId, info).value.kind === 'date';
          case 'inconsistent': {
            const facts = cellFacts(data, rowId, info);
            return isInconsistent(facts.value, facts.raw, info);
          }
        }
      };
  }
}

/** Linhas que passam em todos os filtros, na ordem recebida. */
export function filterRows(
  table: Table,
  rowIds: readonly number[],
  filters: readonly ColumnFilter[],
  inference: Record<string, ColumnInference>,
): number[] {
  const tests = filters
    .filter((f) => table.data.has(f.colId))
    .map((f) => compileFilter(table, f, inference));
  if (tests.length === 0) return [...rowIds];
  return rowIds.filter((rowId) => tests.every((test) => test(rowId)));
}

/** Descrição do filtro para a lista de filtros ativos, ex.: "preço > 10". */
export function describeFilter(filter: ColumnFilter, columnName: string): string {
  const c = filter.condition;
  switch (c.kind) {
    case 'text':
      return `${columnName} ${TEXT_OP_LABELS[c.op]} "${c.value}"${c.caseSensitive ? ' (maiúsculas)' : ''}`;
    case 'number':
      return c.op === 'between'
        ? `${columnName} entre ${c.value} e ${c.value2 ?? ''}`
        : `${columnName} ${NUMBER_OP_LABELS[c.op]} ${c.value}`;
    case 'date':
      return c.op === 'between'
        ? `${columnName} entre ${c.value} e ${c.value2 ?? ''}`
        : `${columnName} ${DATE_OP_LABELS[c.op]} ${c.value}`;
    case 'state':
      return `${columnName} ${STATE_OP_LABELS[c.op]}`;
  }
}
