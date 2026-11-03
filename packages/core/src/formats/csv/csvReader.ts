import Papa from 'papaparse';
import { detectDelimiter } from '../../detect/delimiter.ts';
import { decodeText, detectEncoding } from '../../detect/encoding.ts';
import { assertContentMatches, fileExtension } from '../../detect/format.ts';
import { ImportError } from '../../errors.ts';
import { formatInteger } from '../../format/numbers.ts';
import { assertCellLimit, assertTableLimits } from '../../import/limits.ts';
import { NATIVE, STATE_VALUE } from '../../model/cell.ts';
import type { DataDocument, ImportWarning } from '../../model/document.ts';
import { makeColumnNames } from '../../model/headers.ts';
import { columnData, createTable, setCell } from '../../model/table.ts';
import { CSV_FORMAT } from '../registry.ts';
import type { FormatReader, ReadInput } from '../types.ts';

const isBlankRow = (row: readonly string[]): boolean => row.length === 1 && row[0] === '';

export function readCsv({ bytes, fileName, options }: ReadInput): DataDocument {
  assertContentMatches('csv', bytes);

  const encoding = options.encoding ?? detectEncoding(bytes);
  const text = decodeText(bytes, encoding);
  const delimiter = options.delimiter ?? detectDelimiter(text);
  const hasHeader = options.hasHeader ?? true;
  const warnings: ImportWarning[] = [];

  const result = Papa.parse(text, {
    delimiter,
    quoteChar: '"',
    escapeChar: '"',
    dynamicTyping: false,
    skipEmptyLines: false,
    // Na pré-visualização lê uma linha a mais, para saber se o arquivo continua.
    ...(options.maxRows !== undefined
      ? { preview: options.maxRows + 1 + (hasHeader ? 1 : 0) }
      : {}),
  });

  const missingQuotes = result.errors.find((e) => e.code === 'MissingQuotes');
  if (missingQuotes) {
    const line = missingQuotes.row === undefined ? '' : ` na linha ${missingQuotes.row + 1}`;
    throw new ImportError(
      'INVALID_FILE',
      `CSV inválido: há aspas abertas que não foram fechadas${line}.`,
    );
  }

  // Só as linhas em branco do fim são descartadas; as do meio viram linhas vazias (L25).
  const rows = result.data;
  while (rows.length > 0 && isBlankRow(rows[rows.length - 1] ?? [])) rows.pop();

  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const headerRow = hasHeader && rows.length > 0 ? rows[0] : undefined;
  const dataRows = headerRow ? rows.slice(1) : rows;

  assertTableLimits('', dataRows.length, width);
  assertCellLimit(dataRows.length * width);

  const { names, renamed } = makeColumnNames(
    Array.from({ length: width }, (_, i) => headerRow?.[i]),
  );
  if (hasHeader && renamed > 0) {
    warnings.push({
      code: 'HEADERS_RENAMED',
      message: `${formatInteger(renamed)} nomes de coluna vazios ou repetidos foram ajustados (ex.: "coluna_3", "nome (2)").`,
    });
  }

  const table = createTable({
    id: 't0',
    name: fileName,
    columns: names.map((name) => ({ name })),
    rowCount: dataRows.length,
    defaultState: STATE_VALUE,
  });

  let padded = 0;
  const columns = table.columns.map((c) => columnData(table, c.id));
  dataRows.forEach((row, rowId) => {
    if (row.length < width) padded += 1;
    row.forEach((value, col) => {
      const data = columns[col];
      if (data) setCell(data, rowId, STATE_VALUE, value, NATIVE.none);
    });
  });
  if (padded > 0 && options.maxRows === undefined) {
    warnings.push({
      code: 'ROWS_PADDED',
      message: `${formatInteger(padded)} linhas tinham menos campos que as outras e foram completadas com valores vazios.`,
    });
  }

  return {
    source: {
      fileName,
      extension: fileExtension(fileName),
      format: 'csv',
      sizeBytes: bytes.length,
      importedAt: new Date().toISOString(),
      hasHeader,
      encoding,
      delimiter,
    },
    tables: [table],
    warnings,
  };
}

export const csvReader: FormatReader = { descriptor: CSV_FORMAT, read: readCsv };
