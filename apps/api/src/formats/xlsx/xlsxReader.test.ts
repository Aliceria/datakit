import { describe, expect, it } from 'vitest';
import {
  ImportError,
  NATIVE,
  STATE_VALUE,
  promoteHeaderRow,
  readCell,
  type DataDocument,
  type Table,
} from '@datakit/core';
import { fixture } from '../../test/server.ts';
import { readXlsx } from './xlsxReader.ts';

const read = (name: string) =>
  readXlsx({ bytes: fixture(name), fileName: name.split('/').pop() ?? name, options: {} });

function table(doc: DataDocument, name: string): Table {
  const t = doc.tables.find((x) => x.name === name);
  if (!t) throw new Error(`aba ${name} não encontrada`);
  return t;
}

function cell(t: Table, rowIndex: number, colIndex: number) {
  const column = t.columns[colIndex];
  const rowId = t.rowOrder[rowIndex];
  const data = column && t.data.get(column.id);
  if (!data || rowId === undefined) throw new Error('célula fora da tabela');
  return readCell(data, rowId);
}

describe('XLSX', () => {
  it('importa todas as abas, inclusive vazia e oculta', async () => {
    const doc = await read('xlsx/multi-sheet.xlsx');
    expect(doc.tables.map((t) => [t.name, t.hidden])).toEqual([
      ['Clientes', false],
      ['Vazia', false],
      ['Oculta', true],
    ]);
    expect(table(doc, 'Vazia').rowOrder).toHaveLength(0);
    expect(doc.warnings.map((w) => w.code)).toContain('XLSX_HIDDEN_SHEETS');
  });

  it('valores, tipos nativos, datas, erros, texto rico e porcentagem', async () => {
    const doc = await read('xlsx/multi-sheet.xlsx');
    const t = table(doc, 'Clientes');
    promoteHeaderRow(t);
    expect(t.columns.map((c) => c.name)).toEqual(['nome', 'valor', 'data', 'cep', 'dobro', 'taxa']);
    expect(cell(t, 0, 1)).toMatchObject({ raw: '1234.56', native: NATIVE.number });
    expect(cell(t, 0, 2)).toMatchObject({ raw: '2024-02-01', native: NATIVE.date });
    expect(cell(t, 1, 2)).toMatchObject({ raw: '2024-03-15T13:45:00', native: NATIVE.date });
    // CEP gravado como texto continua texto, com o zero.
    expect(cell(t, 0, 3)).toMatchObject({ raw: '01310100', native: NATIVE.string });
    // Exibido como 15%, o valor real é 0.15 (seção 6.3).
    expect(cell(t, 0, 5)).toMatchObject({ raw: '0.15', native: NATIVE.number });
    expect(cell(t, 1, 0)).toMatchObject({ raw: 'Bia', native: NATIVE.string });
    expect(cell(t, 2, 1)).toMatchObject({ raw: '#DIV/0!', native: NATIVE.error });
    expect(cell(t, 5, 0)).toMatchObject({ raw: 'true', native: NATIVE.boolean });
  });

  it('fórmulas: resultado salvo + fórmula original só para leitura', async () => {
    const doc = await read('xlsx/multi-sheet.xlsx');
    const t = table(doc, 'Clientes');
    promoteHeaderRow(t);
    expect(cell(t, 0, 4)).toMatchObject({ raw: '2469.12', extras: { formula: '=B2*2' } });
    expect(cell(t, 2, 4)).toMatchObject({ raw: '#DIV/0!', extras: { formula: '=1/0' } });
    expect(doc.warnings.map((w) => w.code)).toContain('XLSX_FORMULAS');
  });

  it('células mescladas: valor na primeira, as outras vazias', async () => {
    const doc = await read('xlsx/multi-sheet.xlsx');
    const t = table(doc, 'Clientes');
    promoteHeaderRow(t);
    expect(cell(t, 4, 0).raw).toBe('mesclada');
    expect(cell(t, 4, 1)).toMatchObject({ state: STATE_VALUE, raw: '' });
    expect(cell(t, 4, 2)).toMatchObject({ state: STATE_VALUE, raw: '' });
    expect(doc.warnings.find((w) => w.code === 'XLSX_MERGED')?.message).toMatch(/^1 grupos/);
  });

  it('avisa o que não é preservado', async () => {
    const doc = await read('xlsx/multi-sheet.xlsx');
    expect(doc.warnings.find((w) => w.code === 'XLSX_NOT_PRESERVED')?.message).toMatch(
      /formatação/,
    );
  });

  it('o número grande vem como o double que o arquivo guarda, sem notação exponencial', async () => {
    const doc = await read('xlsx/multi-sheet.xlsx');
    const t = table(doc, 'Clientes');
    promoteHeaderRow(t);
    expect(cell(t, 3, 1).raw).toBe('12345678901234567000');
  });

  it('sistema de datas 1904', async () => {
    const doc = await read('xlsx/dates-1904.xlsx');
    expect(doc.source.date1904).toBe(true);
    const t = table(doc, 'Datas');
    promoteHeaderRow(t);
    expect(cell(t, 0, 1).raw).toBe('2024-02-01');
    expect(cell(t, 1, 1).raw).toBe('1999-12-31T23:59:00');
  });
});

describe('XLSX inválido', () => {
  const failsWith = async (name: string, code: string, message: RegExp) => {
    const err: unknown = await read(name).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ImportError);
    expect((err as ImportError).code).toBe(code);
    expect((err as ImportError).message).toMatch(message);
  };

  it('conteúdo de texto com extensão .xlsx', () =>
    failsWith('invalid/csv-content.xlsx', 'EXTENSION_MISMATCH', /conteúdo é texto/));

  it('ZIP que não é planilha', () =>
    failsWith('invalid/not-xlsx-zip.xlsx', 'EXTENSION_MISMATCH', /xl\/workbook.xml/));

  it('zip bomb com tamanho declarado acima do limite', () =>
    failsWith('invalid/zip-bomb.xlsx', 'ZIP_LIMITS', /200 MB/));

  it('zip bomb que mente o tamanho', () =>
    failsWith('invalid/zip-bomb-lying.xlsx', 'ZIP_LIMITS', /limites de segurança/));
});
