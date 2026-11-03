import ExcelJS from 'exceljs';
import {
  ImportError,
  NATIVE,
  STATE_VALUE,
  XLSX_FORMAT,
  assertCellLimit,
  assertContentMatches,
  assertTableLimits,
  columnData,
  createTable,
  fileExtension,
  formatInteger,
  numberToPlainString,
  setCell,
  type DataDocument,
  type FormatReader,
  type ImportWarning,
  type NativeCode,
  type ReadInput,
  type Table,
} from '@datakit/core';
import { isOleFile, readZipDirectory, verifyZipContents } from '../../security/zipGuard.ts';

// Leitor XLSX (seção 6.3). Produz sempre a versão SEM cabeçalho; quem chama aplica
// promoteHeaderRow quando a primeira linha for o cabeçalho.

type Converted = { raw: string; native: NativeCode; empty: boolean };

const EMPTY: Converted = { raw: '', native: NATIVE.none, empty: true };
const pad = (n: number, size = 2) => String(n).padStart(size, '0');

/** Data do XLSX como texto ISO sem fuso (o ExcelJS entrega a data em UTC — R12). */
function dateToIso(d: Date): string {
  const date = `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const s = d.getUTCSeconds();
  return h === 0 && m === 0 && s === 0 ? date : `${date}T${pad(h)}:${pad(m)}:${pad(s)}`;
}

function richTextToString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'richText' in value) {
    const parts = (value as { richText: Array<{ text: string }> }).richText;
    return parts.map((p) => p.text).join('');
  }
  return '';
}

/** Converte um valor do ExcelJS (resultado de fórmula ou valor simples). */
function convertPlain(value: unknown): Converted {
  if (value === null || value === undefined) return EMPTY;
  if (typeof value === 'number') {
    return { raw: numberToPlainString(value), native: NATIVE.number, empty: false };
  }
  if (typeof value === 'string') return { raw: value, native: NATIVE.string, empty: false };
  if (typeof value === 'boolean') {
    return { raw: value ? 'true' : 'false', native: NATIVE.boolean, empty: false };
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return EMPTY;
    return { raw: dateToIso(value), native: NATIVE.date, empty: false };
  }
  if (typeof value === 'object') {
    if ('error' in value) {
      return {
        raw: String(value.error),
        native: NATIVE.error,
        empty: false,
      };
    }
    if ('richText' in value) {
      return { raw: richTextToString(value), native: NATIVE.string, empty: false };
    }
    if ('text' in value) {
      // Hiperlink: fica o texto exibido.
      return {
        raw: richTextToString(value.text),
        native: NATIVE.string,
        empty: false,
      };
    }
  }
  return EMPTY;
}

type SheetCounters = {
  formulas: number;
  formulasWithoutResult: number;
  merges: Set<string>;
  formatting: boolean;
  comments: number;
};

function readSheet(ws: ExcelJS.Worksheet, id: string, counters: SheetCounters): Table {
  // 1ª passada: extensão real dos dados (células só com formatação não contam).
  let maxRow = 0;
  let maxCol = 0;
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      if (cell.type === ExcelJS.ValueType.Merge || cell.type === ExcelJS.ValueType.Null) return;
      maxRow = Math.max(maxRow, rowNumber);
      maxCol = Math.max(maxCol, colNumber);
    });
  });

  // O limite de linhas desconta o cabeçalho; a checagem final é feita depois da promoção.
  assertTableLimits(ws.name, Math.max(0, maxRow - 1), maxCol);

  const table = createTable({
    id,
    name: ws.name,
    hidden: ws.state !== 'visible',
    columns: Array.from({ length: maxCol }, () => ({ name: '' })),
    rowCount: maxRow,
    defaultState: STATE_VALUE,
  });
  const columns = table.columns.map((c) => columnData(table, c.id));

  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const data = columns[colNumber - 1];
      if (!data) return;
      const rowId = rowNumber - 1;

      if (cell.isMerged) counters.merges.add(cell.master.address);
      if (cell.note) counters.comments += 1;
      if (!counters.formatting && hasFormatting(cell)) counters.formatting = true;

      // Célula mesclada que não é a primeira: fica vazia (seção 6.3).
      if (cell.type === ExcelJS.ValueType.Merge) return;

      if (cell.type === ExcelJS.ValueType.Formula) {
        counters.formulas += 1;
        const converted = convertPlain(cell.result);
        if (converted.empty) counters.formulasWithoutResult += 1;
        setCell(data, rowId, STATE_VALUE, converted.raw, converted.native, {
          formula: `=${cell.formula}`,
        });
        return;
      }

      const converted = convertPlain(cell.value);
      if (!converted.empty) setCell(data, rowId, STATE_VALUE, converted.raw, converted.native);
    });
  });
  return table;
}

function hasFormatting(cell: ExcelJS.Cell): boolean {
  const fmt = cell.numFmt;
  if (fmt && fmt !== 'General') return true;
  const font = cell.font as Partial<ExcelJS.Font> | undefined;
  if (font && (font.bold || font.italic || font.underline || font.color)) return true;
  const fill = cell.fill as ExcelJS.Fill | undefined;
  return fill?.type === 'pattern' && fill.pattern !== 'none';
}

export async function readXlsx({ bytes, fileName }: ReadInput): Promise<DataDocument> {
  if (isOleFile(bytes)) {
    throw new ImportError(
      'INVALID_FILE',
      'O arquivo parece ser uma planilha .xls antiga ou um XLSX protegido por senha. ' +
        'O DataKit abre só arquivos .xlsx sem senha.',
    );
  }
  assertContentMatches('xlsx', bytes);

  const entries = readZipDirectory(bytes);
  const names = new Set(entries.map((e) => e.name));
  if (!names.has('xl/workbook.xml')) {
    throw new ImportError(
      'EXTENSION_MISMATCH',
      'O arquivo tem extensão .xlsx, mas não é uma planilha XLSX (falta xl/workbook.xml).',
    );
  }
  verifyZipContents(bytes, entries);

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(bytes.slice().buffer);
  } catch {
    throw new ImportError(
      'INVALID_FILE',
      'Não foi possível ler a planilha: o arquivo XLSX está corrompido.',
    );
  }

  const counters: SheetCounters = {
    formulas: 0,
    formulasWithoutResult: 0,
    merges: new Set(),
    formatting: false,
    comments: 0,
  };
  const tables = workbook.worksheets.map((ws, i) => readSheet(ws, `t${i}`, counters));
  assertCellLimit(tables.reduce((sum, t) => sum + t.rowOrder.length * t.columns.length, 0));

  const warnings: ImportWarning[] = [];
  const hidden = tables.filter((t) => t.hidden).length;
  if (hidden > 0) {
    warnings.push({
      code: 'XLSX_HIDDEN_SHEETS',
      message: `${formatInteger(hidden)} ${hidden === 1 ? 'aba estava oculta e foi importada' : 'abas estavam ocultas e foram importadas'} (marcada como oculta).`,
    });
  }
  if (counters.formulas > 0) {
    warnings.push({
      code: 'XLSX_FORMULAS',
      message: `${formatInteger(counters.formulas)} células tinham fórmula. O DataKit usa o resultado salvo no arquivo e vai exportá-las como valores; a fórmula original aparece no inspetor de célula.`,
    });
  }
  if (counters.formulasWithoutResult > 0) {
    warnings.push({
      code: 'XLSX_FORMULAS_WITHOUT_RESULT',
      message: `${formatInteger(counters.formulasWithoutResult)} fórmulas não tinham resultado salvo no arquivo e ficaram vazias.`,
    });
  }
  if (counters.merges.size > 0) {
    warnings.push({
      code: 'XLSX_MERGED',
      message: `${formatInteger(counters.merges.size)} grupos de células mescladas: o valor ficou na primeira célula e as outras ficaram vazias.`,
    });
  }

  const lost: string[] = [];
  if (counters.formatting) lost.push('formatação');
  if (counters.comments > 0 || [...names].some((n) => n.startsWith('xl/comments'))) {
    lost.push('comentários');
  }
  if ([...names].some((n) => n.startsWith('xl/media/'))) lost.push('imagens');
  if ([...names].some((n) => n.startsWith('xl/charts/'))) lost.push('gráficos');
  if (workbook.worksheets.some((ws) => hasDataValidations(ws))) lost.push('validações de dados');
  if (names.has('xl/vbaProject.bin')) lost.push('macros');
  if (lost.length > 0) {
    warnings.push({
      code: 'XLSX_NOT_PRESERVED',
      message: `Não são preservados: ${lost.join(', ')}.`,
    });
  }

  return {
    source: {
      fileName,
      extension: fileExtension(fileName),
      format: 'xlsx',
      sizeBytes: bytes.length,
      importedAt: new Date().toISOString(),
      hasHeader: false,
      ...(workbook.properties.date1904 ? { date1904: true } : {}),
    },
    tables,
    warnings,
  };
}

function hasDataValidations(ws: ExcelJS.Worksheet): boolean {
  const model = (ws as unknown as { dataValidations?: { model?: Record<string, unknown> } })
    .dataValidations?.model;
  return model !== undefined && Object.keys(model).length > 0;
}

export const xlsxReader: FormatReader = { descriptor: XLSX_FORMAT, read: readXlsx };
