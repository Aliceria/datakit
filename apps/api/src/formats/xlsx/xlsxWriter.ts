import { PassThrough } from 'node:stream';
import ExcelJS from 'exceljs';
import { outputValue, type OutContext, type Table } from '@datakit/core';

// Escritor XLSX (seção 10), com o ExcelJS em modo streaming: 100.000 linhas × 20 colunas sem
// montar a planilha inteira na memória. Textos nunca são gravados como fórmula (seção 12):
// o ExcelJS só escreve fórmula quando recebe um objeto { formula }, e aqui só vão valores.

export type XlsxSheet = { table: Table; rowIds: readonly number[] };
export type XlsxOptions = { header: boolean; nativeTypes: boolean };

/** Caracteres que o Excel não aceita no nome da aba; o nome tem até 31 caracteres. */
const INVALID_SHEET_CHARS = /[\\/?*[\]:]/g;

function sheetNames(tables: readonly Table[]): string[] {
  const used = new Set<string>();
  return tables.map((t) => {
    const base =
      t.name
        .replace(INVALID_SHEET_CHARS, '_')
        .replace(/^'+|'+$/g, '')
        .trim() || 'Planilha';
    let name = base.slice(0, 31);
    for (let n = 2; used.has(name.toLowerCase()); n += 1) {
      const suffix = ` (${String(n)})`;
      name = base.slice(0, 31 - suffix.length) + suffix;
    }
    used.add(name.toLowerCase());
    return name;
  });
}

type CellValue = string | number | boolean | Date | null;

export async function writeXlsx(
  sheets: readonly XlsxSheet[],
  options: XlsxOptions,
): Promise<Buffer> {
  const output = new PassThrough();
  const parts: Buffer[] = [];
  output.on('data', (chunk: Buffer) => parts.push(chunk));
  const done = new Promise<void>((resolve, reject) => {
    output.on('end', resolve);
    output.on('error', reject);
  });
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    stream: output,
    useSharedStrings: true,
    useStyles: true,
  });
  const names = sheetNames(sheets.map((s) => s.table));
  const ctx: OutContext = { format: 'xlsx', stats: { longNumbers: 0 } };

  sheets.forEach(({ table, rowIds }, i) => {
    const sheet = workbook.addWorksheet(names[i], {
      // Abas ocultas continuam ocultas (L28).
      state: table.hidden ? 'hidden' : 'visible',
    });
    const columns = table.columns.map((c) => ({ column: c, data: table.data.get(c.id) }));
    if (options.header) sheet.addRow(columns.map((c) => c.column.name)).commit();
    for (const rowId of rowIds) {
      const values: CellValue[] = [];
      const formats: Array<string | undefined> = [];
      for (const { data } of columns) {
        let value: CellValue = null;
        let numFmt: string | undefined;
        if (data) {
          const out = outputValue(data, rowId, ctx);
          if (!options.nativeTypes) {
            value =
              out.kind === 'absent' || out.kind === 'null' || out.kind === 'empty'
                ? null
                : (data.raw[rowId] ?? '');
          } else {
            switch (out.kind) {
              case 'absent':
              case 'null':
              case 'empty':
                value = null;
                break;
              case 'number':
                // Até 15 dígitos significativos (outputValue garante): o double representa o texto.
                value = Number(out.text);
                break;
              case 'boolean':
                value = out.value;
                break;
              case 'date': {
                const p = out.parts;
                value = new Date(Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second));
                numFmt = out.withTime ? 'yyyy-mm-dd hh:mm:ss' : 'yyyy-mm-dd';
                break;
              }
              case 'string':
              case 'json':
                value = out.text;
                break;
            }
          }
        }
        values.push(value);
        formats.push(numFmt);
      }
      const row = sheet.addRow(values);
      formats.forEach((fmt, c) => {
        if (fmt) row.getCell(c + 1).numFmt = fmt;
      });
      row.commit();
    }
    sheet.commit();
  });
  await workbook.commit();
  await done;
  return Buffer.concat(parts);
}
