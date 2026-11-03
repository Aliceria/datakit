import { describe, expect, it } from 'vitest';
import { readCsv } from '../formats/csv/csvReader.ts';
import { readJson } from '../formats/json/jsonReader.ts';
import { classifyValue, inferColumn } from '../infer/classify.ts';
import { NATIVE } from '../model/cell.ts';
import { readCell, type Table } from '../model/table.ts';
import { applyEffect } from './effects.ts';
import { planDeleteRows } from './planners.ts';
import {
  findDuplicateRows,
  findEmptyRows,
  planClearColumns,
  planConvertType,
  planFillEmpty,
  planReplaceValue,
  planTransform,
  transformText,
} from './tools.ts';

const utf8 = (s: string) => new TextEncoder().encode(s);
const fail = (): never => {
  throw new Error('ausente');
};
const csv = (text: string): Table =>
  readCsv({ bytes: utf8(text), fileName: 'x.csv', options: {} }).tables[0] ?? fail();
const json = (text: string): Table =>
  readJson({ bytes: utf8(text), fileName: 'x.json', options: {} }).tables[0] ?? fail();
const col = (t: Table, colId = 'c0') =>
  t.rowOrder.map((id) => readCell(t.data.get(colId) ?? fail(), id).raw);
const exact = { ignoreCase: false, trim: false };
const br = { numberLocale: 'br', dateFormat: 'dmy' } as const;

describe('remover duplicadas', () => {
  const t = csv('nome;cidade\nAna;Rio\nana ;Rio\nAna;Rio\nBia;SP\nAna;SP\n');

  it('linha inteira, mantendo a primeira ocorrência', () => {
    expect(findDuplicateRows(t, t.rowOrder, ['c0', 'c1'], exact)).toEqual([2]);
  });

  it('ignorar maiúsculas e aparar espaços; só colunas escolhidas', () => {
    const loose = { ignoreCase: true, trim: true };
    expect(findDuplicateRows(t, t.rowOrder, ['c0', 'c1'], loose)).toEqual([1, 2]);
    expect(findDuplicateRows(t, t.rowOrder, ['c0'], exact)).toEqual([2, 4]);
  });

  it('a exclusão volta inteira com desfazer, nas mesmas posições', () => {
    const table = csv('v\na\nb\na\nc\na\n');
    const dup = findDuplicateRows(table, table.rowOrder, ['c0'], exact);
    const inverse = applyEffect([table], planDeleteRows(table, dup));
    expect(col(table)).toEqual(['a', 'b', 'c']);
    applyEffect([table], inverse);
    expect(col(table)).toEqual(['a', 'b', 'a', 'c', 'a']);
  });

  it('nulo, ausente e texto vazio não se confundem', () => {
    const j = json('[{"a":null},{},{"a":""},{"a":null}]');
    expect(findDuplicateRows(j, j.rowOrder, ['c0'], exact)).toEqual([3]);
  });
});

describe('linhas vazias', () => {
  it('todas as células vazias, nulas ou ausentes; espaços opcionais', () => {
    const t = csv('a;b\n1;2\n;\n  ;\n3;\n');
    expect(findEmptyRows(t, t.rowOrder, { whitespaceAsEmpty: false })).toEqual([1]);
    expect(findEmptyRows(t, t.rowOrder, { whitespaceAsEmpty: true })).toEqual([1, 2]);
    const j = json('[{"a":1},{"a":null},{}]');
    expect(findEmptyRows(j, j.rowOrder, { whitespaceAsEmpty: false })).toEqual([1, 2]);
  });
});

describe('converter tipo', () => {
  it('número brasileiro para a forma canônica, exato; o que não converte fica e é contado', () => {
    // Duas colunas: com uma só, a vírgula decimal seria detectada como delimitador.
    const t = csv('v;o\n1.234,56;1\n12345678901234567890,5;1\n;1\nabc;1\n007;1\n');
    const plan = planConvertType(t, 'c0', t.rowOrder, 'number', br);
    expect(plan.failed).toEqual([3]);
    applyEffect([t], plan.effect);
    expect(col(t)).toEqual(['1234.56', '12345678901234567890.5', '', 'abc', '7']);
    const data = t.data.get('c0') ?? fail();
    expect(data.native[0]).toBe(NATIVE.number);
    // 3 números em 4 valores (75%): a coluna fica "misto" até o usuário tratar o "abc".
    expect(inferColumn(data, t.rowOrder).type).toBe('mixed');
  });

  it('número internacional', () => {
    const t = csv('v\n"1,234.56"\n10\n');
    const intl = { numberLocale: 'intl', dateFormat: 'dmy' } as const;
    applyEffect([t], planConvertType(t, 'c0', t.rowOrder, 'number', intl).effect);
    expect(col(t)).toEqual(['1234.56', '10']);
  });

  it('datas para aaaa-mm-dd, com hora quando houver; formato de origem respeitado', () => {
    const t = csv('d\n31/12/2023\n01/02/2024 10:30\n2024-03-15\n32/01/2024\n');
    const plan = planConvertType(t, 'c0', t.rowOrder, 'date', br);
    expect(plan.failed).toEqual([3]);
    applyEffect([t], plan.effect);
    expect(col(t)).toEqual(['2023-12-31', '2024-02-01T10:30:00', '2024-03-15', '32/01/2024']);
    const t2 = csv('d\n01/02/2024\n2024-03-15\n');
    const ymd = { numberLocale: 'br', dateFormat: 'ymd' } as const;
    expect(planConvertType(t2, 'c0', t2.rowOrder, 'date', ymd).failed).toEqual([0]);
  });

  it('booleano', () => {
    const t = csv('b\nSim\nnão\nTRUE\ntalvez\n');
    const plan = planConvertType(t, 'c0', t.rowOrder, 'boolean', br);
    expect(plan.failed).toEqual([3]);
    applyEffect([t], plan.effect);
    expect(col(t)).toEqual(['true', 'false', 'true', 'talvez']);
  });

  it('texto: o valor não muda, mas deixa de ser interpretado', () => {
    const t = csv('v\n10\n20\n');
    const data = t.data.get('c0') ?? fail();
    expect(inferColumn(data, t.rowOrder).type).toBe('number');
    applyEffect([t], planConvertType(t, 'c0', t.rowOrder, 'text', br).effect);
    expect(col(t)).toEqual(['10', '20']);
    const info = inferColumn(data, t.rowOrder);
    expect(info.type).toBe('text');
    expect(classifyValue(0, '10', NATIVE.text, info).kind).toBe('text');
  });

  it('desfazer volta o texto e o tipo nativo originais; só as linhas pedidas', () => {
    const j = json('[{"v":"1,5"},{"v":"2,5"}]');
    const inverse = applyEffect([j], planConvertType(j, 'c0', [1], 'number', br).effect);
    expect(col(j)).toEqual(['1,5', '2.5']);
    applyEffect([j], inverse);
    expect(col(j)).toEqual(['1,5', '2,5']);
    expect((j.data.get('c0') ?? fail()).native[1]).toBe(NATIVE.string);
  });
});

describe('operações em colunas', () => {
  it('maiúsculas, minúsculas e Primeira Letra Maiúscula em português', () => {
    expect(transformText('são joão-del rei', 'title')).toBe('São João-Del Rei');
    expect(transformText('ação', 'upper')).toBe('AÇÃO');
    expect(transformText('  x  ', 'trim')).toBe('x');
  });

  it('só as células que mudam entram na operação', () => {
    const t = csv('a;b\n x ;y\nz;w\n');
    const plan = planTransform(t, ['c0', 'c1'], t.rowOrder, 'trim');
    expect(plan.cells).toBe(1);
    applyEffect([t], plan.effect);
    expect(col(t)).toEqual(['x', 'z']);
  });

  it('preencher vazios, substituir valor e limpar coluna', () => {
    const t = json('[{"a":"x"},{"a":null},{},{"a":"  "},{"a":"x"}]');
    const fill = planFillEmpty(t, ['c0'], t.rowOrder, 'N/D');
    expect(fill.cells).toBe(3);
    applyEffect([t], fill.effect);
    expect(col(t)).toEqual(['x', 'N/D', 'N/D', 'N/D', 'x']);
    const rep = planReplaceValue(t, ['c0'], t.rowOrder, 'x', 'y');
    expect(rep.cells).toBe(2);
    applyEffect([t], rep.effect);
    expect(col(t)).toEqual(['y', 'N/D', 'N/D', 'N/D', 'y']);
    applyEffect([t], planClearColumns(t, ['c0'], [0, 1]).effect);
    expect(col(t)).toEqual(['', '', 'N/D', 'N/D', 'y']);
  });
});
