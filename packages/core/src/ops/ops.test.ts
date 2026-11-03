import { describe, expect, it } from 'vitest';
import { readJson } from '../formats/json/jsonReader.ts';
import { readCsv } from '../formats/csv/csvReader.ts';
import { NATIVE, STATE_NULL, STATE_VALUE } from '../model/cell.ts';
import type { Table } from '../model/table.ts';
import { LIMITS } from '../params.ts';
import { parseTsv, toTsv } from '../clipboard/tsv.ts';
import { applyEffect, readValue, type Effect, EffectError } from './effects.ts';
import {
  applyLogOp,
  cellKey,
  emptyHistory,
  emptyMarks,
  type EditorState,
  type LogOp,
} from './history.ts';
import { nativeAfterEdit } from './nativeType.ts';
import {
  planClear,
  planDeleteColumns,
  planDeleteRows,
  planInsertColumns,
  planInsertRows,
  planPaste,
  planRenameColumn,
  planSetNull,
  planSetText,
} from './planners.ts';

const utf8 = (s: string) => new TextEncoder().encode(s);

function csvTable(text: string): Table {
  const table = readCsv({ bytes: utf8(text), fileName: 'x.csv', options: {} }).tables[0];
  if (!table) throw new Error('sem tabela');
  return table;
}

function jsonTable(text: string): Table {
  const table = readJson({ bytes: utf8(text), fileName: 'x.json', options: {} }).tables[0];
  if (!table) throw new Error('sem tabela');
  return table;
}

/** Retrato completo da tabela, para comparar estados. */
function snapshot(table: Table) {
  return {
    columns: table.columns.map((c) => ({ ...c })),
    rowOrder: [...table.rowOrder],
    cells: table.rowOrder.map((rowId) =>
      table.columns.map((c) => {
        const data = table.data.get(c.id);
        return data ? readValue(data, rowId) : undefined;
      }),
    ),
  };
}

const grid = (t: Table) =>
  t.rowOrder.map((rowId) =>
    t.columns.map((c) => readValue(t.data.get(c.id) ?? fail(), rowId).r ?? '∅'),
  );
const fail = (): never => {
  throw new Error('coluna ausente');
};

describe('efeitos e inversos', () => {
  it('setCells e o inverso restauram estado, texto, tipo nativo e fórmula', () => {
    const t = jsonTable('[{"a": 123, "b": "x"}]');
    const before = snapshot(t);
    const inverse = applyEffect([t], planSetNull(t, [{ rowId: 0, colId: 'c0' }]));
    expect(readValue(t.data.get('c0') ?? fail(), 0).s).toBe(STATE_NULL);
    applyEffect([t], inverse);
    expect(snapshot(t)).toEqual(before);
  });

  it('inserir e excluir linhas, inclusive no meio, e desfazer', () => {
    const t = csvTable('a;b\n1;2\n3;4\n5;6\n');
    const before = snapshot(t);
    const ins = applyEffect([t], planInsertRows([t], t, 1, 2));
    expect(grid(t)).toEqual([
      ['1', '2'],
      ['', ''],
      ['', ''],
      ['3', '4'],
      ['5', '6'],
    ]);
    applyEffect([t], ins);
    expect(snapshot(t)).toEqual(before);

    const del = applyEffect([t], planDeleteRows(t, [0, 2]));
    expect(grid(t)).toEqual([['3', '4']]);
    applyEffect([t], del);
    expect(snapshot(t)).toEqual(before);
  });

  it('IDs de linha são estáveis e nunca reutilizados', () => {
    const t = csvTable('a\n1\n');
    const e1 = planInsertRows([t], t, 1, 1);
    const inv = applyEffect([t], e1);
    applyEffect([t], inv);
    const e2 = planInsertRows([t], t, 1, 1);
    expect(e2.type === 'insertRows' && e2.rows[0]?.rowId).toBe(2);
  });

  it('inserir e excluir colunas, e desfazer', () => {
    const t = csvTable('a;b\n1;2\n');
    const before = snapshot(t);
    const ins = applyEffect([t], planInsertColumns([t], t, 1, 1));
    expect(t.columns.map((c) => c.name)).toEqual(['a', 'coluna_2', 'b']);
    applyEffect([t], ins);
    expect(snapshot(t)).toEqual(before);
    const del = applyEffect([t], planDeleteColumns(t, ['c0']));
    expect(t.columns.map((c) => c.name)).toEqual(['b']);
    applyEffect([t], del);
    expect(snapshot(t)).toEqual(before);
  });

  it('renomear coluna de JSON aninhado troca só a última chave (L22)', () => {
    const t = jsonTable('[{"endereco": {"cidade": "SP"}}]');
    const inv = applyEffect([t], planRenameColumn(t, 'c0', 'municipio'));
    expect(t.columns[0]).toMatchObject({
      name: 'endereco.municipio',
      path: ['endereco', 'municipio'],
    });
    applyEffect([t], inv);
    expect(t.columns[0]).toMatchObject({ name: 'endereco.cidade', path: ['endereco', 'cidade'] });
  });

  it('lote é tudo ou nada', () => {
    const t = csvTable('a\n1\n');
    const before = snapshot(t);
    const bad: Effect = {
      type: 'batch',
      effects: [planSetText(t, [{ rowId: 0, colId: 'c0' }], 'novo'), planDeleteRows(t, [99])],
    };
    expect(() => applyEffect([t], bad)).toThrow(EffectError);
    expect(snapshot(t)).toEqual(before);
  });

  it('referências inválidas são recusadas', () => {
    const t = csvTable('a\n1\n');
    expect(() =>
      applyEffect([t], {
        type: 'setCells',
        tableId: 't0',
        cells: [{ rowId: 5, colId: 'c0', value: { s: 0, r: '', t: 0 } }],
      }),
    ).toThrow(EffectError);
    expect(() => applyEffect([t], { type: 'setCells', tableId: 't9', cells: [] })).toThrow(
      EffectError,
    );
    expect(() =>
      applyEffect([t], { type: 'deleteColumns', tableId: 't0', colIds: ['c7'] }),
    ).toThrow(EffectError);
  });
});

describe('tipo nativo na edição (seção 4.2, L5)', () => {
  it('mantém o tipo quando compatível; vira texto quando não', () => {
    expect(nativeAfterEdit(NATIVE.number, '124', NATIVE.none)).toBe(NATIVE.number);
    expect(nativeAfterEdit(NATIVE.number, '12345678901234567890', NATIVE.none)).toBe(NATIVE.number);
    expect(nativeAfterEdit(NATIVE.number, '1.234,56', NATIVE.none)).toBe(NATIVE.string);
    expect(nativeAfterEdit(NATIVE.number, '0012', NATIVE.none)).toBe(NATIVE.string);
    expect(nativeAfterEdit(NATIVE.string, '123', NATIVE.none)).toBe(NATIVE.string);
    expect(nativeAfterEdit(NATIVE.boolean, 'false', NATIVE.none)).toBe(NATIVE.boolean);
    expect(nativeAfterEdit(NATIVE.boolean, 'FALSE', NATIVE.none)).toBe(NATIVE.string);
    expect(nativeAfterEdit(NATIVE.date, '2024-02-01', NATIVE.none)).toBe(NATIVE.date);
    expect(nativeAfterEdit(NATIVE.date, '01/02/2024', NATIVE.none)).toBe(NATIVE.string);
  });

  it('célula sem tipo herda o predominante da coluna; CSV continua sem tipo', () => {
    expect(nativeAfterEdit(NATIVE.none, '123', NATIVE.string)).toBe(NATIVE.string);
    expect(nativeAfterEdit(NATIVE.none, '123', NATIVE.number)).toBe(NATIVE.number);
    expect(nativeAfterEdit(NATIVE.none, '123', NATIVE.none)).toBe(NATIVE.none);
  });

  it('editar uma célula nula de coluna JSON de strings mantém string', () => {
    const t = jsonTable('[{"cod": "1"}, {"cod": null}, {"cod": "3"}]');
    const effect = planSetText(t, [{ rowId: 1, colId: 'c0' }], '123');
    expect(effect.type === 'setCells' && effect.cells[0]?.value).toEqual({
      s: STATE_VALUE,
      r: '123',
      t: NATIVE.string,
    });
  });

  it('Delete deixa texto vazio, nunca nulo nem ausente', () => {
    const t = jsonTable('[{"a": 1, "b": null}]');
    applyEffect(
      [t],
      planClear(t, [
        { rowId: 0, colId: 'c0' },
        { rowId: 0, colId: 'c1' },
      ]),
    );
    expect(readValue(t.data.get('c0') ?? fail(), 0)).toMatchObject({ s: STATE_VALUE, r: '' });
    expect(readValue(t.data.get('c1') ?? fail(), 0)).toMatchObject({ s: STATE_VALUE, r: '' });
  });
});

describe('colar', () => {
  it('cola um bloco de texto e preserva zeros e números grandes', () => {
    const t = csvTable('a;b\n1;2\n3;4\n');
    const plan = planPaste(
      [t],
      t,
      t.rowOrder,
      { rowIndex: 0, colIndex: 0, rows: 1, cols: 1 },
      {
        kind: 'text',
        rows: [['0012', '12345678901234567890']],
      },
    );
    applyEffect([t], plan.effect);
    expect(grid(t)).toEqual([
      ['0012', '12345678901234567890'],
      ['3', '4'],
    ]);
  });

  it('uma célula colada numa seleção maior preenche a seleção', () => {
    const t = csvTable('a;b\n1;2\n3;4\n');
    const plan = planPaste(
      [t],
      t,
      t.rowOrder,
      { rowIndex: 0, colIndex: 0, rows: 2, cols: 2 },
      {
        kind: 'text',
        rows: [['x']],
      },
    );
    applyEffect([t], plan.effect);
    expect(grid(t)).toEqual([
      ['x', 'x'],
      ['x', 'x'],
    ]);
  });

  it('além da borda cria linhas e colunas, e um único desfazer volta tudo', () => {
    const t = csvTable('a\n1\n');
    const before = snapshot(t);
    const plan = planPaste(
      [t],
      t,
      t.rowOrder,
      { rowIndex: 0, colIndex: 0, rows: 1, cols: 1 },
      {
        kind: 'text',
        rows: [
          ['p', 'q'],
          ['r', 's'],
        ],
      },
    );
    expect([plan.addedRows, plan.addedCols]).toEqual([1, 1]);
    const inverse = applyEffect([t], plan.effect);
    expect(grid(t)).toEqual([
      ['p', 'q'],
      ['r', 's'],
    ]);
    applyEffect([t], inverse);
    expect(snapshot(t)).toEqual(before);
  });

  it('valores copiados do próprio DataKit mantêm nulo e tipo (L18)', () => {
    const t = csvTable('a;b\n1;2\n');
    const plan = planPaste(
      [t],
      t,
      t.rowOrder,
      { rowIndex: 0, colIndex: 0, rows: 1, cols: 1 },
      {
        kind: 'cells',
        rows: [
          [
            { s: STATE_NULL, t: 0 },
            { s: STATE_VALUE, r: '7', t: NATIVE.number },
          ],
        ],
      },
    );
    applyEffect([t], plan.effect);
    expect(readValue(t.data.get('c0') ?? fail(), 0).s).toBe(STATE_NULL);
    expect(readValue(t.data.get('c1') ?? fail(), 0)).toMatchObject({ r: '7', t: NATIVE.number });
  });

  it('respeita o limite de colunas', () => {
    const t = csvTable('a\n1\n');
    const wide = [Array.from({ length: LIMITS.maxColumnsPerTable + 1 }, () => 'x')];
    expect(() =>
      planPaste(
        [t],
        t,
        t.rowOrder,
        { rowIndex: 0, colIndex: 0, rows: 1, cols: 1 },
        { kind: 'text', rows: wide },
      ),
    ).toThrow(/limite/);
  });
});

describe('TSV', () => {
  it('ida e volta com tabulação, quebra de linha e aspas', () => {
    const rows = [
      ['a', 'b\tc', 'd\ne'],
      ['"x"', '', 'fim'],
    ];
    expect(parseTsv(toTsv(rows))).toEqual(rows);
  });

  it('formato do Excel: CRLF e quebra de linha final', () => {
    expect(parseTsv('1\t2\r\n3\t4\r\n')).toEqual([
      ['1', '2'],
      ['3', '4'],
    ]);
    expect(parseTsv('\r\n')).toEqual([['']]);
    expect(parseTsv('')).toEqual([]);
  });
});

describe('histórico', () => {
  const state = (t: Table): EditorState => ({
    tables: [t],
    history: emptyHistory(),
    marks: emptyMarks(),
  });
  let seq = 0;
  const edit = (effect: Effect, label = 'Editar'): LogOp => ({
    seq: ++seq,
    opId: `op${String(seq)}`,
    kind: 'edit',
    label,
    effect,
  });
  const undo = (): LogOp => ({ seq: ++seq, opId: `op${String(seq)}`, kind: 'undo' });
  const redo = (): LogOp => ({ seq: ++seq, opId: `op${String(seq)}`, kind: 'redo' });

  it('desfazer e refazer; uma edição nova limpa o refazer', () => {
    const t = csvTable('a\n1\n');
    const s = state(t);
    applyLogOp(s, edit(planSetText(t, [{ rowId: 0, colId: 'c0' }], '2')));
    applyLogOp(s, edit(planSetText(t, [{ rowId: 0, colId: 'c0' }], '3')));
    applyLogOp(s, undo());
    expect(grid(t)).toEqual([['2']]);
    applyLogOp(s, redo());
    expect(grid(t)).toEqual([['3']]);
    applyLogOp(s, undo());
    applyLogOp(s, edit(planSetText(t, [{ rowId: 0, colId: 'c0' }], '9')));
    expect(s.history.redo).toHaveLength(0);
    expect(() => {
      applyLogOp(s, redo());
    }).toThrow();
  });

  it('guarda no máximo 100 operações', () => {
    const t = csvTable('a\n1\n');
    const s = state(t);
    for (let i = 0; i < 120; i += 1)
      applyLogOp(s, edit(planSetText(t, [{ rowId: 0, colId: 'c0' }], String(i))));
    expect(s.history.undo).toHaveLength(100);
  });

  it('marca células, linhas e colunas alteradas e conta as alterações', () => {
    const t = csvTable('a;b\n1;2\n');
    const s = state(t);
    applyLogOp(s, edit(planSetText(t, [{ rowId: 0, colId: 'c1' }], 'x')));
    applyLogOp(s, edit(planInsertRows([t], t, 1, 1)));
    const m = s.marks.tables.get('t0');
    expect(m?.cells.has(cellKey(0, 'c1'))).toBe(true);
    expect(m?.rows.has(1)).toBe(true);
    expect(s.marks.changes).toBe(2);
  });

  it('reaplicar o mesmo log a partir do mesmo início dá o mesmo resultado', () => {
    const text = 'a;b;c\n1;2;3\n4;5;6\n';
    const log: LogOp[] = [];
    const t1 = csvTable(text);
    const s1 = state(t1);
    const push = (op: LogOp) => {
      log.push(op);
      applyLogOp(s1, op);
    };
    push(edit(planSetText(t1, [{ rowId: 1, colId: 'c2' }], 'z')));
    push(edit(planInsertColumns([t1], t1, 0, 2)));
    push(edit(planDeleteRows(t1, [0])));
    push(undo());
    push(edit(planRenameColumn(t1, 'c1', 'bb')));
    push(undo());
    push(redo());

    const t2 = csvTable(text);
    const s2 = state(t2);
    for (const op of JSON.parse(JSON.stringify(log)) as LogOp[]) applyLogOp(s2, op);
    expect(snapshot(t2)).toEqual(snapshot(t1));
    expect(JSON.stringify(s2.history)).toBe(JSON.stringify(s1.history));
  });

  it('propriedade: operações aleatórias seguidas de desfazer tudo voltam ao original', () => {
    let rnd = 12345;
    const random = (n: number) => {
      rnd = (rnd * 1103515245 + 12345) % 2147483648;
      return rnd % n;
    };
    for (let round = 0; round < 25; round += 1) {
      const t = jsonTable('[{"a": 1, "b": "x", "c": null}, {"a": 2, "d": true}, {"b": "0012"}]');
      const original = snapshot(t);
      const s = state(t);
      let applied = 0;
      for (let i = 0; i < 30; i += 1) {
        const rows = t.rowOrder;
        const cols = t.columns;
        const rowId = rows[random(Math.max(rows.length, 1))];
        const col = cols[random(Math.max(cols.length, 1))];
        let effect: Effect | undefined;
        switch (random(7)) {
          case 0:
            if (rowId !== undefined && col)
              effect = planSetText(t, [{ rowId, colId: col.id }], `v${String(i)}`);
            break;
          case 1:
            if (rowId !== undefined && col) effect = planSetNull(t, [{ rowId, colId: col.id }]);
            break;
          case 2:
            effect = planInsertRows([t], t, random(rows.length + 1), 1 + random(3));
            break;
          case 3:
            if (rows.length > 1 && rowId !== undefined) effect = planDeleteRows(t, [rowId]);
            break;
          case 4:
            effect = planInsertColumns([t], t, random(cols.length + 1), 1);
            break;
          case 5:
            if (cols.length > 1 && col) effect = planDeleteColumns(t, [col.id]);
            break;
          default:
            if (col) effect = planRenameColumn(t, col.id, `n${String(i)}`);
        }
        if (!effect) continue;
        applyLogOp(s, edit(effect));
        applied += 1;
      }
      for (let i = 0; i < applied; i += 1) applyLogOp(s, undo());
      expect(snapshot(t)).toEqual(original);
    }
  });
});
