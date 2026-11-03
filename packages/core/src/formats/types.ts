import type { CsvDelimiter, DataDocument, FormatId, TextEncoding } from '../model/document.ts';

/** Opções confirmadas na pré-visualização. Ausentes = detectar automaticamente. */
export type ImportOptions = {
  /** Primeira linha é o cabeçalho (padrão: sim — seção 6.1). */
  hasHeader?: boolean;
  encoding?: TextEncoding;
  delimiter?: CsvDelimiter;
  /** JSON com raiz objeto: caminho do array de objetos escolhido. */
  jsonRootPath?: string[];
  /** Só para pré-visualização: para depois de ler este número de linhas de dados. */
  maxRows?: number;
};

export type ReadInput = {
  bytes: Uint8Array;
  fileName: string;
  options: ImportOptions;
};

/** Onde a pré-visualização é gerada: no navegador (CSV, JSON) ou no servidor (XLSX — L3). */
export type PreviewLocation = 'client' | 'server';

export type FormatDescriptor = {
  id: FormatId;
  label: string;
  extensions: readonly string[];
  preview: PreviewLocation;
};

/** Contrato de um leitor de formato. Novos formatos só implementam isto e se registram. */
export type FormatReader = {
  descriptor: FormatDescriptor;
  read(input: ReadInput): DataDocument | Promise<DataDocument>;
};
