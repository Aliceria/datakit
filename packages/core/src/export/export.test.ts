import { describe, expect, it } from 'vitest';
import { readCsv } from '../formats/csv/csvReader.ts';
import { readJson } from '../formats/json/jsonReader.ts';
import { readCell, type Table } from '../model/table.ts';
import { applyLogOp, emptyHistory, emptyMarks, type EditorState } from '../ops/history.ts';
import { guardFormula, needsFormulaGuard, significantDigits } from './cellOutput.ts';
import { BOM, writeCsv, type CsvOptions } from './csvWriter.ts';
import { defaultExportName, exportWarnings, type ExportRequest } from './exportPlan.ts';
import { findNestingConflicts, writeJson, type JsonOptions } from './jsonWriter.ts';

const utf8 = (s: string) => new TextEncoder().encode(s);
const fail = (): never => {
  throw new Error('ausente');
};
const csv = (text: string): Table =>
  readCsv({ bytes: utf8(text), fileName: 'x.csv', options: {} }).tables[0] ?? fail();
const json = (text: string): Table =>
  readJson({ bytes: utf8(text), fileName: 'x.json', options: {} }).tables[0] ?? fail();
const ids = (t: Table) => t.columns.map((c) => c.id);
const CSV_STD: CsvOptions = { delimiter: ',', header: true, bom: false, formulaGuard: true };
const OBJECTS: JsonOptions = { shape: 'objects', nested: true, indent: false };

/** Todas as células como [estado, texto], para comparar ida e volta. */
const cells = (t: Table) =>
  t.rowOrder.map((r) =>
    t.columns.map((c) => {
      const v = readCell(t.data.get(c.id) ?? fail(), r);
      return [v.state, v.raw];
    }),
  );

describe('proteção contra fórmulas', () => {
  it('textos perigosos recebem apóstrofo; números não', () => {
    expect(guardFormula('=SOMA(A1)')).toBe("'=SOMA(A1)");
    expect(guardFormula('+55 11 9999')).toBe("'+55 11 9999");
    expect(guardFormula('@usuario')).toBe("'@usuario");
    expect(guardFormula('\tx')).toBe("'\tx");
    expect(guardFormula('-5')).toBe('-5');
    expect(guardFormula('-1.234,56')).toBe('-1.234,56');
    expect(needsFormulaGuard('-')).toBe(true);
    expect(guardFormula('ok')).toBe('ok');
  });
});

describe('CSV', () => {
  it('aspas, quebras de linha, CRLF, BOM e delimitador', () => {
    const t = csv('a;b\n"x;y";"linha\nnova"\n"diz ""oi""";  \n');
    expect(writeCsv(t, t.rowOrder, ids(t), CSV_STD).text).toBe(
      'a,b\r\nx;y,"linha\nnova"\r\n"diz ""oi""",  \r\n',
    );
    const br = writeCsv(t, t.rowOrder, ids(t), { ...CSV_STD, delimiter: ';', bom: true }).text;
    expect(br.startsWith(BOM + 'a;b\r\n"x;y";')).toBe(true);
  });

  it('nulo, ausente e vazio viram campo vazio; zero à esquerda e números longos intactos', () => {
    const t = json('[{"a":null,"b":"0012","c":12345678901234567890},{"b":""}]');
    expect(writeCsv(t, t.rowOrder, ids(t), { ...CSV_STD, header: false }).text).toBe(
      ',0012,12345678901234567890\r\n,,\r\n',
    );
  });

  it('proteção ligada por padrão e contada; desligada mantém o texto', () => {
    const t = csv('f;n\n=1+1;-5\n');
    const on = writeCsv(t, t.rowOrder, ids(t), CSV_STD);
    expect(on.text).toBe("f,n\r\n'=1+1,-5\r\n");
    expect(on.guarded).toBe(1);
    expect(writeCsv(t, t.rowOrder, ids(t), { ...CSV_STD, formulaGuard: false }).text).toBe(
      'f,n\r\n=1+1,-5\r\n',
    );
  });

  it('ida e volta CSV → CSV dá os mesmos dados', () => {
    const source = 'nome;cep;valor;obs\nAna;01310100;1.234,56;"com ; e ""aspas"""\nBia;;10;  \n';
    const t = csv(source);
    const again = csv(writeCsv(t, t.rowOrder, ids(t), { ...CSV_STD, delimiter: ';' }).text);
    expect(cells(again)).toEqual(cells(t));
    expect(again.columns.map((c) => c.name)).toEqual(t.columns.map((c) => c.name));
  });

  it('linhas e colunas pedidas, na ordem dada', () => {
    const t = csv('a;b\n1;2\n3;4\n');
    expect(writeCsv(t, [1, 0], ['c1'], CSV_STD).text).toBe('b\r\n4\r\n2\r\n');
  });
});

describe('JSON', () => {
  it('tipos de origem, números exatos, null, "" e chave ausente omitida', () => {
    const t = json('[{"a":1,"b":"1","c":null,"d":"","e":true},{"a":12345678901234567890}]');
    expect(writeJson(t, t.rowOrder, ids(t), OBJECTS).text).toBe(
      '[{"a":1,"b":"1","c":null,"d":"","e":true},{"a":12345678901234567890}]\n',
    );
  });

  it('CSV para JSON: só número canônico vira número', () => {
    const t = csv('a;b;c;d\n10;0012;1.234,56;2.5\n');
    expect(writeJson(t, t.rowOrder, ids(t), OBJECTS).text).toBe(
      '[{"a":10,"b":"0012","c":"1.234,56","d":2.5}]\n',
    );
  });

  it('reconstrói objetos aninhados na ordem original; sem reconstrução usa chaves com ponto', () => {
    const source = '[{"id":1,"end":{"cidade":"Rio","uf":"RJ"},"x":{}},{"id":2}]';
    const t = json(source);
    expect(writeJson(t, t.rowOrder, ids(t), OBJECTS).text).toBe(`${source}\n`);
    expect(writeJson(t, t.rowOrder, ids(t), { ...OBJECTS, nested: false }).text).toBe(
      '[{"id":1,"end.cidade":"Rio","end.uf":"RJ","x":{}},{"id":2}]\n',
    );
  });

  it('chaves perigosas e repetidas voltam como estavam', () => {
    const source = '[{"__proto__":1,"a":2,"a":3}]';
    const t = json(source);
    expect(writeJson(t, t.rowOrder, ids(t), OBJECTS).text).toBe(`${source}\n`);
  });

  it('array de arrays com cabeçalho e indentação', () => {
    const t = json('[{"a":1,"b":"x"},{"a":null}]');
    expect(writeJson(t, t.rowOrder, ids(t), { ...OBJECTS, shape: 'arrays' }).text).toBe(
      '[["a","b"],[1,"x"],[null,null]]\n',
    );
    expect(writeJson(t, [0], ['c0'], { ...OBJECTS, indent: true }).text).toBe(
      '[\n  {\n    "a": 1\n  }\n]\n',
    );
  });

  it('ida e volta JSON → JSON e CSV → JSON → CSV', () => {
    const source = '[{"n":"Ana","v":1.5,"t":{"a":[1,2]},"z":null},{"n":"Bia","q":"0012"}]';
    const t = json(source);
    const again = json(writeJson(t, t.rowOrder, ids(t), OBJECTS).text);
    expect(cells(again)).toEqual(cells(t));
    const c = csv('a;b\n0012;x\n;y\n');
    const back = json(writeJson(c, c.rowOrder, ids(c), OBJECTS).text);
    expect(writeCsv(back, back.rowOrder, ids(back), { ...CSV_STD, delimiter: ';' }).text).toBe(
      'a;b\r\n0012;x\r\n;y\r\n',
    );
  });

  it('L20: conflito entre "a" e "a.b" na mesma linha é encontrado', () => {
    const t = json('[{"a":1},{"a":{"b":2}}]');
    // Linha 0: a = 1; linha 1: a.b = 2. Nenhuma linha tem os dois.
    expect(findNestingConflicts(t, t.rowOrder, ids(t))).toEqual([]);
    const both = json('[{"a":1,"a.b":2}]');
    expect(findNestingConflicts(both, both.rowOrder, ids(both))).toEqual([]);
    // Depois de o usuário preencher "a" na linha 1, as duas colunas têm valor nela.
    const a = t.data.get('c0') ?? fail();
    a.state[1] = 0;
    a.raw[1] = 'x';
    expect(findNestingConflicts(t, t.rowOrder, ids(t))).toEqual([1]);
  });
});

describe('avisos e nome padrão', () => {
  const t = json('[{"a":null,"b":""},{"c":12345678901234567890}]');
  const req = (options: ExportRequest['options']): ExportRequest => ({
    tableIds: [t.id],
    options,
    fileName: 'x',
  });

  it('CSV avisa que estados ficam iguais; XLSX avisa número longo', () => {
    const csvWarn = exportWarnings([t], req({ ...CSV_STD, format: 'csv' }));
    expect(csvWarn.map((w) => w.code)).toEqual(['STATES_MERGED']);
    expect(csvWarn[0]?.message).toContain('1 nulos');
    const xlsx = exportWarnings(
      [t],
      req({ format: 'xlsx', allSheets: false, header: true, nativeTypes: true }),
    );
    expect(xlsx.map((w) => w.code)).toEqual(['STATES_MERGED', 'LONG_NUMBERS']);
    expect(
      exportWarnings([t], req({ format: 'json', shape: 'objects', nested: true, indent: false })),
    ).toEqual([]);
    expect(significantDigits('123456789012345')).toBe(15);
    expect(significantDigits('0.000120')).toBe(2);
  });

  it('nome do arquivo', () => {
    expect(defaultExportName('vendas.xlsx', 'csv', 'Jan')).toBe('vendas - Jan.csv');
    expect(defaultExportName('dados.json', 'xlsx', undefined)).toBe('dados.xlsx');
  });
});

describe('marcas somem com a exportação completa (L19)', () => {
  it('só da tabela exportada; o contador zera quando não sobra marca', () => {
    const a = csv('v\n1\n');
    const b = csv('v\n2\n');
    b.id = 't1';
    const state: EditorState = { tables: [a, b], history: emptyHistory(), marks: emptyMarks() };
    const edit = (tableId: string, opId: string) => ({
      seq: 0,
      opId,
      kind: 'edit' as const,
      label: 'x',
      effect: {
        type: 'setCells' as const,
        tableId,
        cells: [{ rowId: 0, colId: 'c0', value: { s: 0 as const, r: 'z', t: 0 as const } }],
      },
    });
    applyLogOp(state, edit('t0', '1'));
    applyLogOp(state, edit('t1', '2'));
    applyLogOp(state, { seq: 0, opId: '3', kind: 'exported', tableIds: ['t0'] });
    expect(state.marks.tables.has('t0')).toBe(false);
    expect(state.marks.changes).toBe(2);
    applyLogOp(state, { seq: 0, opId: '4', kind: 'exported', tableIds: ['t1'] });
    expect(state.marks.changes).toBe(0);
    // O histórico de desfazer não muda.
    expect(state.history.undo).toHaveLength(2);
  });
});
