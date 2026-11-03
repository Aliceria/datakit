import { describe, expect, it } from 'vitest';
import { NATIVE, STATE_NULL, STATE_VALUE } from '../model/cell.ts';
import { createColumnData, setCell } from '../model/table.ts';
import { classifyValue, inferColumn, isInconsistent } from './classify.ts';
import { formatIsoDate, parseDate } from './date.ts';
import {
  isNumberIn,
  numberLocaleEvidence,
  numberToPlainString,
  toCanonicalNumber,
} from './number.ts';

describe('números', () => {
  it('formato brasileiro e internacional', () => {
    expect(isNumberIn('1.234,56', 'br')).toBe(true);
    expect(isNumberIn('1.234,56', 'intl')).toBe(false);
    expect(isNumberIn('1,234.56', 'intl')).toBe(true);
    expect(isNumberIn('89,90', 'br')).toBe(true);
    expect(isNumberIn('-5', 'br')).toBe(true);
    expect(isNumberIn('1e10', 'intl')).toBe(true);
    expect(isNumberIn('1.234.567', 'br')).toBe(true);
    expect(isNumberIn('1.5', 'br')).toBe(false);
  });

  it('zero à esquerda é código, não número (L7)', () => {
    for (const raw of ['0012', '01310100', '00123', '012.345.678-90']) {
      expect(isNumberIn(raw, 'br')).toBe(false);
      expect(isNumberIn(raw, 'intl')).toBe(false);
    }
    expect(isNumberIn('0', 'br')).toBe(true);
    expect(isNumberIn('0,5', 'br')).toBe(true);
    expect(isNumberIn('0.5', 'intl')).toBe(true);
  });

  it('evidência de formato', () => {
    expect(numberLocaleEvidence('1.234,56')).toBe('br');
    expect(numberLocaleEvidence('1234.56')).toBe('intl');
    expect(numberLocaleEvidence('1.234')).toBe('both');
    expect(numberLocaleEvidence('1234')).toBe('both');
    expect(numberLocaleEvidence('abc')).toBe('none');
  });

  it('forma canônica não perde dígitos', () => {
    expect(toCanonicalNumber('1.234,56', 'br')).toBe('1234.56');
    expect(toCanonicalNumber('1,234.56', 'intl')).toBe('1234.56');
    expect(toCanonicalNumber('12345678901234567890', 'br')).toBe('12345678901234567890');
    expect(toCanonicalNumber('0012', 'br')).toBeUndefined();
  });

  it('double sem notação exponencial (L9)', () => {
    expect(numberToPlainString(0.15)).toBe('0.15');
    expect(numberToPlainString(1e21)).toBe('1000000000000000000000');
    expect(numberToPlainString(1.5e-7)).toBe('0.00000015');
    expect(numberToPlainString(-2.5e22)).toBe('-25000000000000000000000');
    expect(numberToPlainString(-0)).toBe('0');
    expect(numberToPlainString(0.1 + 0.2)).toBe('0.30000000000000004');
  });
});

describe('datas', () => {
  it('dd/mm/aaaa, aaaa-mm-dd e ISO 8601', () => {
    expect(parseDate('01/02/2024')?.parts).toMatchObject({ year: 2024, month: 2, day: 1 });
    expect(parseDate('01/02/2024 13:45')?.parts).toMatchObject({ hour: 13, minute: 45 });
    expect(parseDate('2024-02-01')?.format).toBe('ymd');
    expect(parseDate('2024-02-01T10:00:00Z')?.format).toBe('iso');
    expect(parseDate('2024-02-01T10:00:00.123-03:00')?.format).toBe('iso');
  });

  it('rejeita datas impossíveis', () => {
    expect(parseDate('31/02/2024')).toBeUndefined();
    expect(parseDate('29/02/2023')).toBeUndefined();
    expect(parseDate('29/02/2024')).toBeDefined();
    expect(parseDate('2024-13-01')).toBeUndefined();
    expect(parseDate('01/02/24')).toBeUndefined();
  });

  it('ISO ingênuo', () => {
    const p = parseDate('05/03/2024 07:08:09')?.parts;
    expect(p && formatIsoDate(p, true)).toBe('2024-03-05T07:08:09');
  });
});

const BR = { numberLocale: 'br' as const, integerCodes: false };

function column(values: Array<string | null>, native: number = NATIVE.none) {
  const data = createColumnData(values.length, STATE_VALUE);
  values.forEach((v, i) => {
    if (v === null) setCell(data, i, STATE_NULL, '');
    else setCell(data, i, STATE_VALUE, v, native as 0);
  });
  return { data, rows: values.map((_, i) => i) };
}

describe('tipo da coluna', () => {
  it('número brasileiro predominante', () => {
    const { data, rows } = column(['1.234,56', '89,90', '10', '', null]);
    const inf = inferColumn(data, rows);
    expect(inf.type).toBe('number');
    expect(inf.numberLocale).toBe('br');
    expect(inf.nonEmpty).toBe(3);
  });

  it('número internacional quando há evidência', () => {
    const { data, rows } = column(['1,234.56', '89.90', '10']);
    expect(inferColumn(data, rows).numberLocale).toBe('intl');
  });

  it('90% decide; abaixo disso é misto', () => {
    const nine = column([...Array<string>(9).fill('10'), 'abc']);
    expect(inferColumn(nine.data, nine.rows).type).toBe('number');
    const eight = column([...Array<string>(8).fill('10'), 'abc', 'def']);
    expect(inferColumn(eight.data, eight.rows).type).toBe('mixed');
  });

  it('CEP com zero à esquerda é texto', () => {
    const { data, rows } = column(['01310100', '04538132', '20040002']);
    expect(inferColumn(data, rows).type).toBe('text');
  });

  it('datas e formato predominante', () => {
    const { data, rows } = column(['01/02/2024', '15/03/2024', '2024-04-01']);
    const inf = inferColumn(data, rows);
    expect(inf.counts.date).toBe(3);
    expect(inf.dateFormat).toBe('dmy');
  });

  it('booleanos sem diferenciar maiúsculas', () => {
    const { data, rows } = column(['true', 'FALSE', 'True']);
    expect(inferColumn(data, rows).type).toBe('boolean');
  });

  it('tipo nativo número vale mesmo para texto que pareceria código', () => {
    const { data, rows } = column(['123', '456'], NATIVE.number);
    expect(inferColumn(data, rows).type).toBe('number');
  });

  it('valores inconsistentes', () => {
    const numberCol = { type: 'number' as const, dateFormat: null };
    expect(isInconsistent(classifyValue(STATE_VALUE, '0012', 0, BR), '0012', numberCol)).toBe(true);
    expect(isInconsistent(classifyValue(STATE_VALUE, '12', 0, BR), '12', numberCol)).toBe(false);
    expect(isInconsistent(classifyValue(STATE_VALUE, ' 12', 0, BR), ' 12', numberCol)).toBe(true);
    const dateCol = { type: 'date' as const, dateFormat: 'dmy' as const };
    const ymd = classifyValue(STATE_VALUE, '2024-01-01', 0, BR);
    expect(isInconsistent(ymd, '2024-01-01', dateCol)).toBe(true);
  });
});
