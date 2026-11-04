// Escritor CSV próprio (docs/PLANO.md: papaparse só lê), para controlar aspas e a proteção
// contra fórmulas. Fim de linha CRLF (RFC 4180, L26).

import type { CsvDelimiter } from '../model/document.ts';
import type { Table } from '../model/table.ts';
import { guardFormula, needsFormulaGuard, outputValue, type OutContext } from './cellOutput.ts';

export type CsvOptions = {
  delimiter: CsvDelimiter;
  header: boolean;
  /** UTF-8 com BOM (predefinição "Excel Brasil"). */
  bom: boolean;
  /** Proteção contra fórmulas (seção 12), ligada por padrão. */
  formulaGuard: boolean;
};

export const CSV_PRESETS = {
  standard: { delimiter: ',', bom: false },
  excelBr: { delimiter: ';', bom: true },
} as const satisfies Record<string, Pick<CsvOptions, 'delimiter' | 'bom'>>;

/** Marca de ordem de bytes do UTF-8 (U+FEFF), escrita como código para não ficar invisível. */
export const BOM = String.fromCharCode(0xfeff);

export type CsvResult = { text: string; guarded: number };

function quote(field: string, delimiter: string): string {
  if (
    field.includes(delimiter) ||
    field.includes('"') ||
    field.includes('\n') ||
    field.includes('\r')
  ) {
    return `"${field.replaceAll('"', '""')}"`;
  }
  return field;
}

/** Gera o CSV das linhas e colunas pedidas, na ordem dada. */
export function writeCsv(
  table: Table,
  rowIds: readonly number[],
  colIds: readonly string[],
  options: CsvOptions,
): CsvResult {
  const columns = colIds.map((id) => ({
    column: table.columns.find((c) => c.id === id),
    data: table.data.get(id),
  }));
  const ctx: OutContext = { format: 'csv', stats: { longNumbers: 0 } };
  let guarded = 0;
  const field = (text: string): string => {
    if (options.formulaGuard && needsFormulaGuard(text)) {
      guarded += 1;
      return quote(guardFormula(text), options.delimiter);
    }
    return quote(text, options.delimiter);
  };

  const lines: string[] = [];
  if (options.header)
    lines.push(columns.map((c) => field(c.column?.name ?? '')).join(options.delimiter));
  for (const rowId of rowIds) {
    const parts: string[] = [];
    for (const { data } of columns) {
      if (!data) {
        parts.push('');
        continue;
      }
      const out = outputValue(data, rowId, ctx);
      switch (out.kind) {
        case 'absent':
        case 'null':
        case 'empty':
          parts.push('');
          break;
        case 'boolean':
          parts.push(out.value ? 'true' : 'false');
          break;
        case 'date':
        case 'number':
        case 'string':
        case 'json':
          // Datas e números saem com o texto da célula; o CSV não tem tipos.
          parts.push(field(data.raw[rowId] ?? ''));
          break;
      }
    }
    lines.push(parts.join(options.delimiter));
  }
  const body = lines.length > 0 ? `${lines.join('\r\n')}\r\n` : '';
  return { text: (options.bom ? BOM : '') + body, guarded };
}
