import { describe, expect, it } from 'vitest';
import { readCsv } from '../formats/csv/csvReader.ts';
import { readJson } from '../formats/json/jsonReader.ts';
import { inferColumn } from '../infer/classify.ts';
import type { Table } from '../model/table.ts';
import { inspectCell, profileColumn } from './columnProfile.ts';

const utf8 = (s: string) => new TextEncoder().encode(s);
const fail = (): never => {
  throw new Error('ausente');
};
const first = (t: Table | undefined) => t ?? fail();
const profile = (t: Table, colId = 'c0') => {
  const data = t.data.get(colId) ?? fail();
  return profileColumn(data, t.rowOrder, inferColumn(data, t.rowOrder));
};

describe('inspetor de coluna', () => {
  it('números: contagens, mínimo e máximo exatos, média', () => {
    const t = first(
      readCsv({
        bytes: utf8('v;o\n1.234,56;1\n10,00;1\n;1\n  ;1\n10,00;1\n-5;1\n'),
        fileName: 'x.csv',
        options: {},
      }).tables[0],
    );
    const p = profile(t);
    expect(p).toMatchObject({
      nonEmpty: 4,
      empty: 1,
      whitespace: 1,
      distinct: 3,
      min: '-5',
      max: '1.234,56',
      maxLength: 8,
    });
    expect(p.mean).toBeCloseTo(312.39, 2);
  });

  it('datas, nulos, ausentes e inconsistentes', () => {
    const t = first(
      readJson({
        bytes: utf8('[{"d":"01/02/2024"},{"d":"31/12/2023"},{"d":null},{},{"d":" 05/05/2024"}]'),
        fileName: 'x.json',
        options: {},
      }).tables[0],
    );
    expect(profile(t)).toMatchObject({
      nulls: 1,
      absent: 1,
      oldest: '31/12/2023',
      newest: '01/02/2024',
      inconsistent: 1,
    });
  });
});

describe('inspetor de célula', () => {
  it('valor interpretado, estado, tipo nativo e comprimento', () => {
    const t = first(
      readJson({
        bytes: utf8('[{"v":"1.234,56"},{"v":null},{"v":"  "},{"v":7}]'),
        fileName: 'x.json',
        options: {},
      }).tables[0],
    );
    const data = t.data.get('c0') ?? fail();
    const info = inferColumn(data, t.rowOrder);
    expect(inspectCell(data, 0, info)).toMatchObject({
      state: 'value',
      kind: 'number',
      native: 'string',
      length: 8,
      interpreted: 'número 1234.56',
    });
    expect(inspectCell(data, 1, info)).toMatchObject({ state: 'null', length: 0 });
    expect(inspectCell(data, 2, info)).toMatchObject({ state: 'whitespace', raw: '  ', length: 2 });
    expect(inspectCell(data, 3, info)).toMatchObject({ native: 'number', kind: 'number' });
    expect(inspectCell(data, 3, info).interpreted).toBeUndefined();
  });
});
