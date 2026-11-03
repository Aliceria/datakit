// Inspetor de coluna e de célula (seção 9). Só leitura: nada aqui altera dados.

import { isInconsistent, type ColumnInference, type ValueKind } from '../infer/classify.ts';
import { formatIsoDate, parseDate } from '../infer/date.ts';
import { NATIVE, STATE_ABSENT, STATE_NULL, STATE_VALUE, nativeName } from '../model/cell.ts';
import type { ColumnData } from '../model/table.ts';
import { compareDecimal, type Decimal } from '../util/decimal.ts';
import { cellFacts } from '../view/facts.ts';

export type ColumnProfile = {
  /** Valores não vazios de cada tipo. */
  counts: Record<Exclude<ValueKind, 'empty'>, number>;
  nonEmpty: number;
  empty: number;
  whitespace: number;
  nulls: number;
  absent: number;
  distinct: number;
  inconsistent: number;
  /** Números: texto original do menor e do maior (exatos) e média aproximada. */
  min?: string;
  max?: string;
  mean?: number;
  /** Datas: texto original da mais antiga e da mais recente. */
  oldest?: string;
  newest?: string;
  /** Maior comprimento de texto, em caracteres. */
  maxLength: number;
};

const decimalToNumber = (d: Decimal) => Number(`${d.negative ? '-' : ''}${d.int}.${d.frac || '0'}`);

/** Calcula em uma passada. Para 100.000 linhas leva poucas dezenas de milissegundos. */
export function profileColumn(
  data: ColumnData,
  rowIds: readonly number[],
  info: ColumnInference,
): ColumnProfile {
  const p: ColumnProfile = {
    counts: { text: 0, number: 0, date: 0, boolean: 0, json: 0 },
    nonEmpty: 0,
    empty: 0,
    whitespace: 0,
    nulls: 0,
    absent: 0,
    distinct: 0,
    inconsistent: 0,
    maxLength: 0,
  };
  const distinct = new Set<string>();
  let min: { d: Decimal; raw: string } | undefined;
  let max: { d: Decimal; raw: string } | undefined;
  let sum = 0;
  let numbers = 0;
  let oldest: { k: number; raw: string } | undefined;
  let newest: { k: number; raw: string } | undefined;

  for (const rowId of rowIds) {
    const state = data.state[rowId];
    if (state === STATE_NULL) {
      p.nulls += 1;
      continue;
    }
    if (state === STATE_ABSENT) {
      p.absent += 1;
      continue;
    }
    const raw = data.raw[rowId] ?? '';
    if (raw === '') {
      p.empty += 1;
      continue;
    }
    if (raw.trim() === '') {
      p.whitespace += 1;
      continue;
    }
    const facts = cellFacts(data, rowId, info);
    const kind = facts.value.kind;
    if (kind === 'empty') continue;
    p.nonEmpty += 1;
    p.counts[kind] += 1;
    distinct.add(raw);
    if (raw.length > p.maxLength) p.maxLength = raw.length;
    if (isInconsistent(facts.value, raw, info)) p.inconsistent += 1;
    if (facts.decimal) {
      const d = facts.decimal;
      if (!min || compareDecimal(d, min.d) < 0) min = { d, raw };
      if (!max || compareDecimal(d, max.d) > 0) max = { d, raw };
      sum += decimalToNumber(d);
      numbers += 1;
    }
    if (facts.dateKey !== undefined) {
      const k = facts.dateKey;
      if (!oldest || k < oldest.k) oldest = { k, raw };
      if (!newest || k > newest.k) newest = { k, raw };
    }
  }
  p.distinct = distinct.size;
  if (min && max) {
    p.min = min.raw;
    p.max = max.raw;
    p.mean = sum / numbers;
  }
  if (oldest && newest) {
    p.oldest = oldest.raw;
    p.newest = newest.raw;
  }
  return p;
}

export type CellInspection = {
  state: 'value' | 'empty' | 'whitespace' | 'null' | 'absent';
  raw: string;
  kind: ValueKind;
  native: string;
  length: number;
  /** Valor interpretado, quando se aplica: "número 1234.56", "data 2024-02-01". */
  interpreted?: string;
  formula?: string;
  inconsistent: boolean;
};

export function inspectCell(
  data: ColumnData,
  rowId: number,
  info: ColumnInference,
): CellInspection {
  const facts = cellFacts(data, rowId, info);
  const native = nativeName(data.native[rowId] ?? NATIVE.none);
  const formula = data.extras.get(rowId)?.formula;
  let state: CellInspection['state'] = 'value';
  if (facts.state === STATE_NULL) state = 'null';
  else if (facts.state === STATE_ABSENT) state = 'absent';
  else if (facts.raw === '') state = 'empty';
  else if (facts.raw.trim() === '') state = 'whitespace';

  const result: CellInspection = {
    state,
    raw: facts.state === STATE_VALUE ? facts.raw : '',
    kind: facts.value.kind,
    native,
    // Em pontos de código: um emoji conta como um caractere.
    length: Array.from(facts.raw).length,
    inconsistent: isInconsistent(facts.value, facts.raw, info),
  };
  if (formula) result.formula = formula;
  if (facts.decimal) {
    const d = facts.decimal;
    const text = `${d.negative ? '-' : ''}${d.int || '0'}${d.frac ? `.${d.frac}` : ''}`;
    if (text !== facts.raw) result.interpreted = `número ${text}`;
  } else if (facts.value.kind === 'date') {
    const parsed = parseDate(facts.raw.trim());
    if (parsed) {
      const { hour, minute, second } = parsed.parts;
      const iso = formatIsoDate(parsed.parts, hour + minute + second > 0);
      if (iso !== facts.raw) result.interpreted = `data ${iso}`;
    }
  } else if (facts.value.kind === 'boolean') {
    const b = facts.raw.trim().toLowerCase();
    if (b !== facts.raw) result.interpreted = `booleano ${b}`;
  }
  return result;
}
