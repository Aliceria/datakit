// Pedido de exportação e avisos de perda (seções 10 e 10.2). Os avisos são calculados no
// navegador, antes de exportar, com as mesmas regras que o servidor usa para gerar o arquivo.

import { formatInteger } from '../format/numbers.ts';
import { STATE_ABSENT, STATE_NULL, STATE_VALUE } from '../model/cell.ts';
import type { CsvDelimiter } from '../model/document.ts';
import type { Table } from '../model/table.ts';
import {
  needsFormulaGuard,
  outputValue,
  type ExportFormat,
  type OutContext,
} from './cellOutput.ts';
import { findNestingConflicts } from './jsonWriter.ts';

export type ExportOptions =
  | { format: 'csv'; delimiter: CsvDelimiter; header: boolean; bom: boolean; formulaGuard: boolean }
  | { format: 'xlsx'; allSheets: boolean; header: boolean; nativeTypes: boolean }
  | { format: 'json'; shape: 'objects' | 'arrays'; nested: boolean; indent: boolean };

export type ExportRequest = {
  /** Tabelas exportadas: a ativa (CSV, JSON, XLSX só a atual) ou todas (XLSX). */
  tableIds: string[];
  /** Só as linhas visíveis, na ordem atual (uma tabela); ausente = todas, na ordem dos dados. */
  rowIds?: number[];
  options: ExportOptions;
  fileName: string;
};

export type ExportWarning = { code: string; message: string };

/** A tabela é exportada por inteiro? Só então as marcas de alteração dela somem (L19). */
export function isFullExport(request: ExportRequest): boolean {
  return request.rowIds === undefined;
}

export function rowsToExport(table: Table, request: ExportRequest): readonly number[] {
  return request.rowIds ?? table.rowOrder;
}

/** Avisos do que a conversão apaga ou muda, com contagens (seção 10.2 e docs/PLANO.md, regra 5). */
export function exportWarnings(tables: readonly Table[], request: ExportRequest): ExportWarning[] {
  const { options } = request;
  const format: ExportFormat = options.format;
  const ctx: OutContext = { format, stats: { longNumbers: 0 } };
  let nulls = 0;
  let absent = 0;
  let empty = 0;
  let guarded = 0;
  let conflicts = 0;
  for (const table of tables.filter((t) => request.tableIds.includes(t.id))) {
    const rows = rowsToExport(table, request);
    for (const column of table.columns) {
      const data = table.data.get(column.id);
      if (!data) continue;
      for (const rowId of rows) {
        const state = data.state[rowId] ?? STATE_VALUE;
        if (state === STATE_NULL) nulls += 1;
        else if (state === STATE_ABSENT) absent += 1;
        else if ((data.raw[rowId] ?? '') === '') empty += 1;
        else if (options.format === 'xlsx' && options.nativeTypes) {
          // Conta os números longos que vão como texto.
          outputValue(data, rowId, ctx);
        } else if (
          options.format === 'csv' &&
          options.formulaGuard &&
          needsFormulaGuard(data.raw[rowId] ?? '')
        ) {
          guarded += 1;
        }
      }
    }
    if (options.format === 'json' && options.shape === 'objects' && options.nested) {
      conflicts += findNestingConflicts(
        table,
        rows,
        table.columns.map((c) => c.id),
      ).length;
    }
  }

  const n = formatInteger;
  const warnings: ExportWarning[] = [];
  const kinds = [
    nulls > 0 ? `${n(nulls)} nulos` : '',
    absent > 0 ? `${n(absent)} ausentes` : '',
    empty > 0 ? `${n(empty)} vazios` : '',
  ].filter(Boolean);
  if (format !== 'json' && kinds.length > 1) {
    const where =
      format === 'csv' ? 'no CSV, viram campo vazio' : 'no XLSX, viram célula sem valor';
    warnings.push({
      code: 'STATES_MERGED',
      message: `Nulos, ausentes e vazios ficam iguais ${where} (${kinds.join(', ')}).`,
    });
  } else if (format !== 'json' && (nulls > 0 || absent > 0)) {
    warnings.push({
      code: 'STATES_MERGED',
      message: `${kinds.join(', ')} ${format === 'csv' ? 'viram campo vazio no CSV' : 'viram célula sem valor no XLSX'}.`,
    });
  }
  if (options.format === 'json' && options.shape === 'arrays' && absent > 0) {
    warnings.push({
      code: 'ABSENT_AS_NULL',
      message: `Em array de arrays, ${n(absent)} valores ausentes viram null.`,
    });
  }
  if (ctx.stats.longNumbers > 0) {
    warnings.push({
      code: 'LONG_NUMBERS',
      message: `${n(ctx.stats.longNumbers)} números com mais de 15 dígitos saem como texto no XLSX, para não perder dígitos.`,
    });
  }
  if (guarded > 0) {
    warnings.push({
      code: 'FORMULA_GUARD',
      message: `${n(guarded)} textos que começam com =, +, -, @, tabulação ou retorno recebem um ' na frente (proteção contra fórmulas).`,
    });
  }
  if (conflicts > 0) {
    warnings.push({
      code: 'NESTING_CONFLICT',
      message: `${n(conflicts)} linhas têm valor numa coluna e numa coluna dentro dela (ex.: "a" e "a.b"). Desligue "reconstruir objetos aninhados" para exportar com as chaves com ponto.`,
    });
  }
  return warnings;
}

/** Nome padrão: o original com a extensão nova; com várias abas, "arquivo - Aba.csv" (L28). */
export function defaultExportName(
  sourceName: string,
  format: ExportFormat,
  sheetName: string | undefined,
): string {
  const base = sourceName.replace(/\.[^./\\]+$/, '') || 'dados';
  return sheetName ? `${base} - ${sheetName}.${format}` : `${base}.${format}`;
}
