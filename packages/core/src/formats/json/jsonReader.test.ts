import { describe, expect, it } from 'vitest';
import { ImportError } from '../../errors.ts';
import { NATIVE, STATE_ABSENT, STATE_NULL, STATE_VALUE } from '../../model/cell.ts';
import { readCell, type Table } from '../../model/table.ts';
import { JsonNumber, JsonObject, parseJson, stringifyJson } from './jsonParser.ts';
import { inspectJson, readJson } from './jsonReader.ts';

const utf8 = (s: string) => new TextEncoder().encode(s);
const read = (text: string, options = {}) =>
  readJson({ bytes: utf8(text), fileName: 'dados.json', options });

function cell(table: Table, rowIndex: number, name: string) {
  const column = table.columns.find((c) => c.name === name);
  const data = column && table.data.get(column.id);
  const rowId = table.rowOrder[rowIndex];
  if (!data || rowId === undefined) throw new Error(`célula ${rowIndex}/${name} não existe`);
  return readCell(data, rowId);
}

describe('parser', () => {
  it('mantém a ordem das chaves, inclusive numéricas', () => {
    const v = parseJson('{"b":1,"10":2,"a":3,"2":4}', 32);
    expect(v instanceof JsonObject && v.keys).toEqual(['b', '10', 'a', '2']);
  });

  it('mantém chaves repetidas', () => {
    const v = parseJson('{"a":1,"a":2}', 32) as JsonObject;
    expect(v.keys).toEqual(['a', 'a']);
    expect(v.values.map((x) => (x as JsonNumber).raw)).toEqual(['1', '2']);
  });

  it('guarda o texto exato dos números', () => {
    const v = parseJson('[12345678901234567890, 1.50, -0, 1E+3]', 32) as JsonNumber[];
    expect(v.map((n) => n.raw)).toEqual(['12345678901234567890', '1.50', '-0', '1E+3']);
  });

  it('decodifica escapes', () => {
    expect(parseJson('"a\\"b\\n\\u00e7"', 32)).toBe('a"b\nç');
  });

  it('erro com linha e coluna', () => {
    expect(() => parseJson('{\n  "a": 1,\n  "b" 2\n}', 32)).toThrow(
      /JSON inválido na linha 3, coluna 7: esperado ":"/,
    );
    expect(() => parseJson('[1, 2', 32)).toThrow(/linha 1, coluna 6/);
    expect(() => parseJson('', 32)).toThrow(/vazio/);
    expect(() => parseJson('[1] x', 32)).toThrow(/conteúdo extra/);
    expect(() => parseJson('[01]', 32)).toThrow(/esperado/);
  });

  it('limite de profundidade', () => {
    const deep = (n: number) => '['.repeat(n) + ']'.repeat(n);
    expect(() => parseJson(deep(32), 32)).not.toThrow();
    expect(() => parseJson(deep(33), 32)).toThrow(/32 níveis/);
  });

  it('serializa de volta sem perder números', () => {
    const v = parseJson('{"x":[1,12345678901234567890,{"y":null}]}', 32);
    expect(stringifyJson(v)).toBe('{"x":[1,12345678901234567890,{"y":null}]}');
  });
});

describe('array de objetos', () => {
  const text = JSON.stringify([
    { id: 1, nome: 'Ana', endereco: { cidade: 'SP', 'cep.num': '01310100' }, tags: ['a', 'b'] },
    { id: 2, nome: null, extra: '' },
    { id: 3, endereco: {}, nome: '123' },
  ]);

  it('colunas na ordem em que aparecem, com caminho', () => {
    const table = read(text).tables[0] as Table;
    expect(table.columns.map((c) => c.name)).toEqual([
      'id',
      'nome',
      'endereco.cidade',
      'endereco.cep.num',
      'tags',
      'extra',
      'endereco',
    ]);
    const cepColumn = table.columns.find((c) => c.name === 'endereco.cep.num');
    expect(cepColumn?.path).toEqual(['endereco', 'cep.num']);
  });

  it('ausente, nulo e vazio são estados diferentes', () => {
    const table = read(text).tables[0] as Table;
    expect(cell(table, 1, 'nome').state).toBe(STATE_NULL);
    expect(cell(table, 1, 'extra')).toMatchObject({ state: STATE_VALUE, raw: '' });
    expect(cell(table, 0, 'extra').state).toBe(STATE_ABSENT);
    expect(cell(table, 1, 'endereco.cidade').state).toBe(STATE_ABSENT);
  });

  it('"123" texto e 123 número continuam diferentes', () => {
    const table = read(text).tables[0] as Table;
    expect(cell(table, 2, 'nome')).toMatchObject({ raw: '123', native: NATIVE.string });
    expect(cell(table, 2, 'id')).toMatchObject({ raw: '3', native: NATIVE.number });
  });

  it('arrays e objetos vazios viram texto JSON com tipo json', () => {
    const table = read(text).tables[0] as Table;
    expect(cell(table, 0, 'tags')).toMatchObject({ raw: '["a","b"]', native: NATIVE.json });
    expect(cell(table, 2, 'endereco')).toMatchObject({ raw: '{}', native: NATIVE.json });
  });

  it('inteiros acima de 2^53 não perdem dígitos', () => {
    const table = read('[{"n": 12345678901234567890}, {"n": 9007199254740993}]').tables[0] as Table;
    expect(cell(table, 0, 'n').raw).toBe('12345678901234567890');
    expect(cell(table, 1, 'n').raw).toBe('9007199254740993');
  });

  it('__proto__, constructor e prototype são dados comuns', () => {
    const table = read('[{"__proto__": {"x": 1}, "constructor": "c", "prototype": 2}]')
      .tables[0] as Table;
    expect(table.columns.map((c) => c.name)).toEqual(['__proto__.x', 'constructor', 'prototype']);
    expect(cell(table, 0, '__proto__.x').raw).toBe('1');
    expect(({} as Record<string, unknown>)['x']).toBeUndefined();
  });

  it('chave repetida vira coluna separada e avisa', () => {
    const doc = read('[{"a": 1, "a": 2}]');
    const table = doc.tables[0] as Table;
    expect(table.columns.map((c) => c.name)).toEqual(['a', 'a (2)']);
    expect(cell(table, 0, 'a (2)').raw).toBe('2');
    expect(doc.warnings.map((w) => w.code)).toContain('JSON_DUPLICATE_KEYS');
  });

  it('chaves numéricas mantêm a ordem do arquivo', () => {
    const table = read('[{"b": 1, "10": 2, "2": 3}]').tables[0] as Table;
    expect(table.columns.map((c) => c.name)).toEqual(['b', '10', '2']);
  });
});

describe('outras raízes', () => {
  it('array de arrays com cabeçalho', () => {
    const table = read('[["nome","idade"],["Ana",30],["Bia"]]').tables[0] as Table;
    expect(table.columns.map((c) => c.name)).toEqual(['nome', 'idade']);
    expect(cell(table, 1, 'idade').state).toBe(STATE_ABSENT);
  });

  it('array de arrays sem cabeçalho', () => {
    const table = read('[[1,2],[3,4]]', { hasHeader: false }).tables[0] as Table;
    expect(table.columns.map((c) => c.name)).toEqual(['coluna_1', 'coluna_2']);
    expect(table.rowOrder).toHaveLength(2);
  });

  it('array de valores simples vira a coluna "valor"', () => {
    const table = read('[1, "a", null, true]').tables[0] as Table;
    expect(table.columns.map((c) => c.name)).toEqual(['valor']);
    expect(cell(table, 2, 'valor').state).toBe(STATE_NULL);
    expect(cell(table, 3, 'valor')).toMatchObject({ raw: 'true', native: NATIVE.boolean });
  });

  it('objeto com arrays de objetos: lista os candidatos e usa o escolhido', () => {
    const text = '{"meta":{"v":1},"clientes":[{"id":1}],"dados":{"pedidos":[{"n":5},{"n":6}]}}';
    expect(inspectJson(utf8(text)).structure.candidates).toEqual([
      ['clientes'],
      ['dados', 'pedidos'],
    ]);
    const doc = read(text, { jsonRootPath: ['dados', 'pedidos'] });
    expect(doc.tables[0]?.rowOrder).toHaveLength(2);
    expect(doc.source.jsonRootPath).toEqual(['dados', 'pedidos']);
    expect(doc.warnings.map((w) => w.code)).toContain('JSON_PARTIAL_ROOT');
  });

  it('raízes não aceitas explicam o motivo', () => {
    expect(() => read('42')).toThrow(/raízes aceitas/);
    expect(() => read('{"a": 1}')).toThrow(/não contém nenhum array de objetos/);
    expect(() => read('[{"a":1}, 2]')).toThrow(/mistura tipos/);
  });

  it('JSON que não é UTF-8 é recusado', () => {
    expect(() =>
      readJson({
        bytes: Uint8Array.from([0x5b, 0x22, 0xe7, 0x22, 0x5d]),
        fileName: 'x.json',
        options: {},
      }),
    ).toThrow(ImportError);
  });
});
