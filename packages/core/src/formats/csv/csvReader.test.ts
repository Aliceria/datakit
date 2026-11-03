import { describe, expect, it } from 'vitest';
import { detectDelimiter } from '../../detect/delimiter.ts';
import { detectEncoding } from '../../detect/encoding.ts';
import { ImportError } from '../../errors.ts';
import { STATE_VALUE } from '../../model/cell.ts';
import { readCell, type Table } from '../../model/table.ts';
import { readCsv } from './csvReader.ts';

const utf8 = (s: string) => new TextEncoder().encode(s);

/** Windows-1252 para os caracteres usados nos testes. */
function cp1252(s: string): Uint8Array {
  const map: Record<string, number> = { ç: 0xe7, ã: 0xe3, é: 0xe9, ó: 0xf3, á: 0xe1, Ç: 0xc7 };
  const bytes: number[] = [];
  for (const ch of s) bytes.push(map[ch] ?? ch.charCodeAt(0));
  return Uint8Array.from(bytes);
}

function grid(table: Table): string[][] {
  return table.rowOrder.map((rowId) =>
    table.columns.map((c) => {
      const data = table.data.get(c.id);
      return data ? readCell(data, rowId).raw : '?';
    }),
  );
}

const read = (bytes: Uint8Array, options = {}) =>
  readCsv({ bytes, fileName: 'teste.csv', options });

describe('detecção', () => {
  it('codificação', () => {
    expect(detectEncoding(utf8('a;b'))).toBe('utf-8');
    expect(detectEncoding(Uint8Array.from([0xef, 0xbb, 0xbf, 0x61]))).toBe('utf-8-bom');
    expect(detectEncoding(cp1252('ação'))).toBe('windows-1252');
  });

  it('delimitador', () => {
    expect(detectDelimiter('a;b;c\n1;2;3\n4;5;6')).toBe(';');
    expect(detectDelimiter('a,b,c\n1,2,3')).toBe(',');
    expect(detectDelimiter('a\tb\n1\t2')).toBe('\t');
    expect(detectDelimiter('a|b\n1|2')).toBe('|');
    // Vírgula decimal dentro de campos com ";" (Excel em português).
    expect(detectDelimiter('nome;preço\nAna;1.234,56\nBia;89,90')).toBe(';');
    // Vírgulas dentro de aspas não contam.
    expect(detectDelimiter('a;b\n"x, y, z";1\n"w, v";2')).toBe(';');
  });
});

describe('leitura', () => {
  it('Excel em português: ";", Windows-1252 e vírgula decimal', () => {
    const doc = read(cp1252('nome;preço;cidade\r\nAna;1.234,56;São Paulo\r\nJoão;89,90;Açú\r\n'));
    expect(doc.source.encoding).toBe('windows-1252');
    expect(doc.source.delimiter).toBe(';');
    const table = doc.tables[0] as Table;
    expect(table.columns.map((c) => c.name)).toEqual(['nome', 'preço', 'cidade']);
    expect(grid(table)).toEqual([
      ['Ana', '1.234,56', 'São Paulo'],
      ['João', '89,90', 'Açú'],
    ]);
  });

  it('UTF-8 com BOM: o BOM não vai parar no nome da primeira coluna', () => {
    const doc = read(Uint8Array.from([0xef, 0xbb, 0xbf, ...utf8('id,nome\n1,Ana')]));
    expect(doc.source.encoding).toBe('utf-8-bom');
    expect(doc.tables[0]?.columns[0]?.name).toBe('id');
  });

  it('aspas, aspas escapadas e quebra de linha dentro de campo', () => {
    const doc = read(utf8('a,b\n"x, y","diz ""oi""\nnova linha"\n'));
    expect(grid(doc.tables[0] as Table)).toEqual([['x, y', 'diz "oi"\nnova linha']]);
  });

  it('zeros à esquerda e números grandes ficam exatamente como estão', () => {
    const doc = read(utf8('cep;cpf;id\n01310100;012.345.678-90;12345678901234567890\n'));
    expect(grid(doc.tables[0] as Table)).toEqual([
      ['01310100', '012.345.678-90', '12345678901234567890'],
    ]);
  });

  it('espaços são preservados', () => {
    const doc = read(utf8('a;b\n  x  ;   \n'));
    expect(grid(doc.tables[0] as Table)).toEqual([['  x  ', '   ']]);
  });

  it('linhas em branco: as do fim saem, as do meio ficam', () => {
    const doc = read(utf8('a;b\n1;2\n\n3;4\n\n\n'));
    const table = doc.tables[0] as Table;
    expect(grid(table)).toEqual([
      ['1', '2'],
      ['', ''],
      ['3', '4'],
    ]);
  });

  it('número variável de campos: completa e avisa', () => {
    const doc = read(utf8('a;b;c\n1;2\n1;2;3;4\n'));
    const table = doc.tables[0] as Table;
    expect(table.columns.map((c) => c.name)).toEqual(['a', 'b', 'c', 'coluna_4']);
    expect(grid(table)).toEqual([
      ['1', '2', '', ''],
      ['1', '2', '3', '4'],
    ]);
    expect(doc.warnings.map((w) => w.code)).toContain('ROWS_PADDED');
    const third = table.data.get('c2');
    expect(third && readCell(third, 0).state).toBe(STATE_VALUE);
  });

  it('cabeçalho vazio vira coluna_N e repetido ganha sufixo', () => {
    const doc = read(utf8('nome;;nome\n1;2;3\n'));
    expect(doc.tables[0]?.columns.map((c) => c.name)).toEqual(['nome', 'coluna_2', 'nome (2)']);
    expect(doc.warnings.map((w) => w.code)).toContain('HEADERS_RENAMED');
  });

  it('sem cabeçalho', () => {
    const doc = read(utf8('1;2\n3;4\n'), { hasHeader: false });
    expect(doc.tables[0]?.columns.map((c) => c.name)).toEqual(['coluna_1', 'coluna_2']);
    expect(grid(doc.tables[0] as Table)).toHaveLength(2);
  });

  it('opções forçadas', () => {
    const doc = read(utf8('a,b;c\n1,2;3\n'), { delimiter: ',' });
    expect(doc.tables[0]?.columns.map((c) => c.name)).toEqual(['a', 'b;c']);
  });

  it('aspas não fechadas são erro com posição', () => {
    expect(() => read(utf8('a;b\n1;"sem fim\n2;3\n'))).toThrow(/aspas.*linha/);
  });

  it('conteúdo binário com extensão .csv é recusado', () => {
    expect(() => read(Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0, 0]))).toThrow(ImportError);
  });

  it('pré-visualização lê só as primeiras linhas', () => {
    const lines = ['a;b', ...Array.from({ length: 100 }, (_, i) => `${i};x`)].join('\n');
    const doc = read(utf8(lines), { maxRows: 20 });
    // Uma a mais que o pedido, para a pré-visualização saber que há mais linhas.
    expect(doc.tables[0]?.rowOrder.length).toBe(21);
  });
});
