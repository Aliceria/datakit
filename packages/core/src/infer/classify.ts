import { NATIVE, STATE_VALUE, type CellState, type NativeCode } from '../model/cell.ts';
import type { ColumnData } from '../model/table.ts';
import { parseDate, type DateFormat } from './date.ts';
import { isNumberIn, numberLocaleEvidence, type NumberLocale } from './number.ts';

/** Tipo inferido de um valor. "empty" = vazio, só espaços, nulo ou ausente. */
export type ValueKind = 'text' | 'number' | 'date' | 'boolean' | 'json' | 'empty';
export type ColumnType = Exclude<ValueKind, 'empty'> | 'mixed';

export type ColumnInference = {
  type: ColumnType;
  numberLocale: NumberLocale;
  /**
   * A coluna tem inteiros com zero à esquerda (CEP, CPF, códigos): então todos os inteiros
   * dela são tratados como código, e não só os que começam com 0 (L7).
   */
  integerCodes: boolean;
  /** Formato predominante entre as datas da coluna. */
  dateFormat: DateFormat | null;
  /** Quantos valores não vazios de cada tipo. */
  counts: Record<Exclude<ValueKind, 'empty'>, number>;
  nonEmpty: number;
};

const BOOLEAN = /^(true|false)$/i;
const INTEGER = /^[+-]?\d+$/;
const LEADING_ZERO_CODE = /^0\d+$/;

/** Contexto da coluna que muda a leitura de um valor isolado. */
export type ColumnContext = { numberLocale: NumberLocale; integerCodes: boolean };

/** Proporção mínima para um tipo ser o da coluna (seção 4.2). */
export const PREDOMINANCE = 0.9;

export type ValueClass = { kind: ValueKind; dateFormat: DateFormat | null };

const EMPTY: ValueClass = { kind: 'empty', dateFormat: null };
const TEXT: ValueClass = { kind: 'text', dateFormat: null };

export function classifyValue(
  state: CellState,
  raw: string,
  native: NativeCode,
  context: ColumnContext,
): ValueClass {
  if (state !== STATE_VALUE || raw.trim() === '') return EMPTY;
  switch (native) {
    case NATIVE.number:
      return { kind: 'number', dateFormat: null };
    case NATIVE.boolean:
      return { kind: 'boolean', dateFormat: null };
    case NATIVE.json:
      return { kind: 'json', dateFormat: null };
    case NATIVE.error:
      return TEXT;
    default:
      break;
  }
  if (BOOLEAN.test(raw)) return { kind: 'boolean', dateFormat: null };
  if (context.integerCodes && INTEGER.test(raw)) return TEXT;
  if (isNumberIn(raw, context.numberLocale)) return { kind: 'number', dateFormat: null };
  const date = parseDate(raw);
  if (date) return { kind: 'date', dateFormat: date.format };
  return TEXT;
}

/**
 * Infere o tipo de uma coluna percorrendo as linhas dadas.
 * Primeiro decide o formato dos números (brasileiro, salvo evidência do contrário — L8),
 * depois classifica cada valor.
 */
export function inferColumn(data: ColumnData, rowIds: readonly number[]): ColumnInference {
  let brOnly = 0;
  let intlOnly = 0;
  let integerCodes = false;
  for (const rowId of rowIds) {
    if (data.state[rowId] !== STATE_VALUE) continue;
    const native = data.native[rowId] ?? NATIVE.none;
    if (native !== NATIVE.none && native !== NATIVE.string) continue;
    const raw = data.raw[rowId] ?? '';
    if (LEADING_ZERO_CODE.test(raw)) integerCodes = true;
    const evidence = numberLocaleEvidence(raw);
    if (evidence === 'br') brOnly += 1;
    else if (evidence === 'intl') intlOnly += 1;
  }
  const numberLocale: NumberLocale = intlOnly > brOnly ? 'intl' : 'br';
  const context: ColumnContext = { numberLocale, integerCodes };

  const counts = { text: 0, number: 0, date: 0, boolean: 0, json: 0 };
  const dateFormats: Record<DateFormat, number> = { dmy: 0, ymd: 0, iso: 0 };
  let nonEmpty = 0;
  for (const rowId of rowIds) {
    const c = classifyValue(
      (data.state[rowId] ?? STATE_VALUE) as CellState,
      data.raw[rowId] ?? '',
      (data.native[rowId] ?? NATIVE.none) as NativeCode,
      context,
    );
    if (c.kind === 'empty') continue;
    nonEmpty += 1;
    counts[c.kind] += 1;
    if (c.dateFormat) dateFormats[c.dateFormat] += 1;
  }

  let type: ColumnType = 'text';
  if (nonEmpty > 0) {
    const [best, bestCount] = (Object.entries(counts) as [keyof typeof counts, number][]).reduce(
      (a, b) => (b[1] > a[1] ? b : a),
    );
    type = bestCount / nonEmpty >= PREDOMINANCE ? best : 'mixed';
  }

  let dateFormat: DateFormat | null = null;
  if (counts.date > 0) {
    dateFormat = (Object.entries(dateFormats) as [DateFormat, number][]).reduce((a, b) =>
      b[1] > a[1] ? b : a,
    )[0];
  }

  return { type, numberLocale, integerCodes, dateFormat, counts, nonEmpty };
}

/**
 * Valor inconsistente (seção 4.2): tipo diferente do predominante, data em formato diferente
 * do predominante, ou texto com espaços no início ou no fim.
 */
export function isInconsistent(
  value: ValueClass,
  raw: string,
  column: Pick<ColumnInference, 'type' | 'dateFormat'>,
): boolean {
  if (value.kind === 'empty') return false;
  if (raw !== raw.trim()) return true;
  if (column.type === 'mixed') return false;
  if (value.kind !== column.type) return true;
  return value.kind === 'date' && value.dateFormat !== column.dateFormat;
}
