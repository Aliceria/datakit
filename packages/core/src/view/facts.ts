import { classifyValue, type ColumnInference, type ValueClass } from '../infer/classify.ts';
import { dateSortKey, parseDate } from '../infer/date.ts';
import { toCanonicalNumber } from '../infer/number.ts';
import { NATIVE, STATE_VALUE, type CellState, type NativeCode } from '../model/cell.ts';
import type { ColumnData } from '../model/table.ts';
import { parseDecimal, type Decimal } from '../util/decimal.ts';

/** O que filtros e ordenação precisam saber de uma célula, sem nunca alterá-la. */
export type CellFacts = {
  state: CellState;
  raw: string;
  value: ValueClass;
  /** Valor numérico exato, quando a célula é número. */
  decimal?: Decimal;
  /** Chave cronológica, quando a célula é data. */
  dateKey?: number;
};

export function cellFacts(data: ColumnData, rowId: number, info: ColumnInference): CellFacts {
  const state = (data.state[rowId] ?? STATE_VALUE) as CellState;
  const raw = state === STATE_VALUE ? (data.raw[rowId] ?? '') : '';
  const native = (data.native[rowId] ?? NATIVE.none) as NativeCode;
  const value = classifyValue(state, raw, native, info);
  const facts: CellFacts = { state, raw, value };
  if (value.kind === 'number') {
    const canonical =
      native === NATIVE.number ? raw.trim() : toCanonicalNumber(raw.trim(), info.numberLocale);
    const decimal = canonical === undefined ? undefined : parseDecimal(canonical);
    if (decimal) facts.decimal = decimal;
  } else if (value.kind === 'date') {
    const parsed = parseDate(raw.trim());
    if (parsed) facts.dateKey = dateSortKey(parsed.parts);
  }
  return facts;
}

/** Inferência neutra, para colunas que ainda não têm uma (coluna recém-criada). */
export const TEXT_INFERENCE: ColumnInference = {
  type: 'text',
  numberLocale: 'br',
  integerCodes: false,
  dateFormat: null,
  counts: { text: 0, number: 0, date: 0, boolean: 0, json: 0 },
  nonEmpty: 0,
};
