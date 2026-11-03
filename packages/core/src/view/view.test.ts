import { describe, expect, it } from 'vitest';
import { inferColumn, type ColumnInference } from '../infer/classify.ts';
import { readCsv } from '../formats/csv/csvReader.ts';
import { readJson } from '../formats/json/jsonReader.ts';
import { readCell, type Table } from '../model/table.ts';
import { applyEffect } from '../ops/effects.ts';
import { planApplyOrder } from '../ops/planners.ts';
import { compareDecimal, parseDecimal } from '../util/decimal.ts';
import { describeFilter, filterRows, FilterError, type ColumnFilter } from './filter.ts';
import { findMatches, matchRanges, replaceInText, type SearchOptions } from './search.ts';
import { sortRows, type SortKey } from './sort.ts';

const utf8 = (s: string) => new TextEncoder().encode(s);
const collator = new Intl.Collator('pt-BR');

function csv(text: string): { table: Table; inference: Record<string, ColumnInference> } {
  const table = readCsv({ bytes: utf8(text), fileName: 'x.csv', options: {} }).tables[0];
  if (!table) throw new Error('sem tabela');
  const inference: Record<string, ColumnInference> = {};
  for (const c of table.columns) {
    const data = table.data.get(c.id);
    if (data) inference[c.id] = inferColumn(data, table.rowOrder);
  }
  return { table, inference };
}

const col = (t: Table, rowIds: readonly number[], colId = 'c0') =>
  rowIds.map((id) => readCell(t.data.get(colId) ?? fail(), id).raw);
const fail = (): never => {
  throw new Error('coluna ausente');
};

describe('decimal exato', () => {
  it('compara sem perder dígitos e entende expoente', () => {
    const d = (s: string) => parseDecimal(s) ?? fail();
    expect(compareDecimal(d('12345678901234567890'), d('12345678901234567891'))).toBe(-1);
    expect(compareDecimal(d('1.50'), d('1.5'))).toBe(0);
    expect(compareDecimal(d('-2'), d('1'))).toBe(-1);
    expect(compareDecimal(d('-0'), d('0'))).toBe(0);
    expect(compareDecimal(d('1E+3'), d('1000'))).toBe(0);
    expect(compareDecimal(d('0.001'), d('1e-3'))).toBe(0);
    expect(parseDecimal('abc')).toBeUndefined();
  });
});

describe('filtros', () => {
  const { table, inference } = csv(
    'nome;preço;data;cep\nAna;1.234,56;01/02/2024;01310100\nbia;89,90;15/03/2024;20040002\n;10;;\nÁlvaro;x;31/12/2023;0012\n',
  );
  const run = (filters: ColumnFilter[]) =>
    col(table, filterRows(table, table.rowOrder, filters, inference));

  it('texto, sem diferenciar maiúsculas por padrão', () => {
    expect(
      run([
        {
          colId: 'c0',
          condition: { kind: 'text', op: 'contains', value: 'A', caseSensitive: false },
        },
      ]),
    ).toEqual(['Ana', 'bia', 'Álvaro']);
    expect(
      run([
        {
          colId: 'c0',
          condition: { kind: 'text', op: 'contains', value: 'A', caseSensitive: true },
        },
      ]),
    ).toEqual(['Ana']);
    expect(
      run([
        {
          colId: 'c0',
          condition: { kind: 'text', op: 'startsWith', value: 'á', caseSensitive: false },
        },
      ]),
    ).toEqual(['Álvaro']);
  });

  it('número no formato da coluna, exato, ignorando o que não é número', () => {
    const f = (op: 'gt' | 'lt', value: string): ColumnFilter => ({
      colId: 'c1',
      condition: { kind: 'number', op, value },
    });
    expect(run([f('gt', '89,90')])).toEqual(['Ana']);
    expect(run([f('lt', '100')])).toEqual(['bia', '']);
    expect(
      run([
        { colId: 'c1', condition: { kind: 'number', op: 'between', value: '10', value2: '90' } },
      ]),
    ).toEqual(['bia', '']);
    expect(() => run([f('gt', 'abc')])).toThrow(FilterError);
  });

  it('data', () => {
    expect(
      run([{ colId: 'c2', condition: { kind: 'date', op: 'after', value: '01/01/2024' } }]),
    ).toEqual(['Ana', 'bia']);
    expect(
      run([{ colId: 'c2', condition: { kind: 'date', op: 'before', value: '2024-01-01' } }]),
    ).toEqual(['Álvaro']);
  });

  it('estados e tipos; filtros de colunas diferentes se combinam com E', () => {
    expect(run([{ colId: 'c0', condition: { kind: 'state', op: 'empty' } }])).toEqual(['']);
    // Preço tem 3 números em 4 valores (75%): coluna "misto", sem inconsistentes; "x" é texto.
    expect(run([{ colId: 'c1', condition: { kind: 'state', op: 'isText' } }])).toEqual(['Álvaro']);
    const nums = csv(`n\n${Array.from({ length: 10 }, (_, i) => String(i + 1)).join('\n')}\nx\n`);
    const inconsistent = filterRows(
      nums.table,
      nums.table.rowOrder,
      [{ colId: 'c0', condition: { kind: 'state', op: 'inconsistent' } }],
      nums.inference,
    );
    expect(col(nums.table, inconsistent)).toEqual(['x']);
    expect(
      run([
        { colId: 'c1', condition: { kind: 'state', op: 'isNumber' } },
        { colId: 'c2', condition: { kind: 'state', op: 'notEmpty' } },
      ]),
    ).toEqual(['Ana', 'bia']);
  });

  it('nulo e ausente', () => {
    const t =
      readJson({ bytes: utf8('[{"a":1},{"a":null},{}]'), fileName: 'x.json', options: {} })
        .tables[0] ?? fail();
    expect(
      filterRows(t, t.rowOrder, [{ colId: 'c0', condition: { kind: 'state', op: 'null' } }], {}),
    ).toEqual([1]);
    expect(
      filterRows(t, t.rowOrder, [{ colId: 'c0', condition: { kind: 'state', op: 'absent' } }], {}),
    ).toEqual([2]);
  });

  it('descrição para a lista de filtros ativos', () => {
    expect(
      describeFilter(
        { colId: 'c1', condition: { kind: 'number', op: 'ge', value: '10' } },
        'preço',
      ),
    ).toBe('preço ≥ 10');
  });
});

describe('ordenação', () => {
  const sort = (text: string, keys: SortKey[]) => {
    const { table, inference } = csv(text);
    return col(table, sortRows(table, table.rowOrder, keys, inference, collator.compare));
  };

  it('números numericamente, exatos, com vazios sempre no fim', () => {
    const text = 'v\n10\n9\n\n12345678901234567891\n12345678901234567890\n-1\n';
    expect(sort(text, [{ colId: 'c0', direction: 'asc' }])).toEqual([
      '-1',
      '9',
      '10',
      '12345678901234567890',
      '12345678901234567891',
      '',
    ]);
    expect(sort(text, [{ colId: 'c0', direction: 'desc' }])).toEqual([
      '12345678901234567891',
      '12345678901234567890',
      '10',
      '9',
      '-1',
      '',
    ]);
  });

  it('datas cronologicamente e texto em português', () => {
    expect(
      sort('d\n15/03/2024\n01/02/2024\n31/12/2023\n', [{ colId: 'c0', direction: 'asc' }]),
    ).toEqual(['31/12/2023', '01/02/2024', '15/03/2024']);
    expect(sort('t\nzebra\nárvore\nAbacaxi\n', [{ colId: 'c0', direction: 'asc' }])).toEqual([
      'Abacaxi',
      'árvore',
      'zebra',
    ]);
  });

  it('inconsistentes depois dos valores do tipo, antes dos vazios', () => {
    // A linha vazia fica no meio: as do fim do arquivo são descartadas na leitura (L25).
    const text = 'n\n5\nx\n\n1\n2\n3\n4\n6\n7\n8\n9\n10\n';
    expect(sort(text, [{ colId: 'c0', direction: 'asc' }]).slice(-3)).toEqual(['10', 'x', '']);
  });

  it('critério secundário e estabilidade', () => {
    const text = 'g;n\nb;2\na;2\nb;1\na;1\n';
    const { table, inference } = csv(text);
    const order = sortRows(
      table,
      table.rowOrder,
      [
        { colId: 'c1', direction: 'asc' },
        { colId: 'c0', direction: 'asc' },
      ],
      inference,
      collator.compare,
    );
    expect(
      order.map((id) => `${col(table, [id], 'c0')[0] ?? ''}${col(table, [id], 'c1')[0] ?? ''}`),
    ).toEqual(['a1', 'b1', 'a2', 'b2']);
  });

  it('aplicar a ordem aos dados é uma operação reversível', () => {
    const { table, inference } = csv('v\n3\n1\n2\n');
    const order = sortRows(
      table,
      table.rowOrder,
      [{ colId: 'c0', direction: 'asc' }],
      inference,
      collator.compare,
    );
    const inverse = applyEffect([table], planApplyOrder(table, order));
    expect(col(table, table.rowOrder)).toEqual(['1', '2', '3']);
    applyEffect([table], inverse);
    expect(col(table, table.rowOrder)).toEqual(['3', '1', '2']);
    expect(() => applyEffect([table], planApplyOrder(table, [0, 1]))).toThrow();
  });
});

describe('busca e substituição', () => {
  const opts = (query: string, extra: Partial<SearchOptions> = {}): SearchOptions => ({
    query,
    caseSensitive: false,
    ignoreAccents: false,
    wholeCell: false,
    ...extra,
  });

  it('maiúsculas, acentos e célula inteira', () => {
    expect(matchRanges('São Paulo', opts('sao'))).toEqual([]);
    expect(matchRanges('São Paulo', opts('sao', { ignoreAccents: true }))).toEqual([[0, 3]]);
    expect(matchRanges('Ana ana', opts('ANA'))).toEqual([
      [0, 3],
      [4, 7],
    ]);
    expect(matchRanges('Ana ana', opts('ANA', { caseSensitive: true }))).toEqual([]);
    expect(matchRanges('Ana', opts('an', { wholeCell: true }))).toEqual([]);
    expect(matchRanges('Ana', opts('ana', { wholeCell: true }))).toEqual([[0, 3]]);
  });

  it('substitui exatamente o trecho do texto original', () => {
    expect(
      replaceInText('Conceição e conceicao', opts('conceicao', { ignoreAccents: true }), 'X'),
    ).toBe('X e X');
    expect(replaceInText('  01310100  ', opts('0131'), '9')).toBe('  90100  ');
    expect(replaceInText('abc', opts('abc', { wholeCell: true }), '')).toBe('');
  });

  it('procura só em células com valor, na ordem de leitura', () => {
    const t =
      readJson({
        bytes: utf8('[{"a":"null","b":null},{"a":"x","b":"null"}]'),
        fileName: 'x.json',
        options: {},
      }).tables[0] ?? fail();
    expect(findMatches(t, t.rowOrder, ['c0', 'c1'], opts('null'))).toEqual([
      { rowId: 0, colId: 'c0' },
      { rowId: 1, colId: 'c1' },
    ]);
  });
});
