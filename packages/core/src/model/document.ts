import type { Table } from './table.ts';

export type FormatId = 'csv' | 'xlsx' | 'json';
export type TextEncoding = 'utf-8' | 'utf-8-bom' | 'windows-1252';
export type CsvDelimiter = ',' | ';' | '\t' | '|';

/** Informações do arquivo de origem (painel "Informações do arquivo"). */
export type SourceInfo = {
  fileName: string;
  extension: string;
  format: FormatId;
  sizeBytes: number;
  importedAt: string;
  hasHeader: boolean;
  encoding?: TextEncoding;
  delimiter?: CsvDelimiter;
  /** JSON com raiz objeto: caminho do array importado. */
  jsonRootPath?: string[];
  /** XLSX: as datas usam o sistema 1904. */
  date1904?: boolean;
};

export type ImportWarning = { code: string; message: string };

export type DataDocument = {
  source: SourceInfo;
  tables: Table[];
  warnings: ImportWarning[];
};
