import type {
  CsvDelimiter,
  ImportOptions,
  JsonRootKind,
  PreviewTable,
  TextEncoding,
} from '@datakit/core';

export type PreviewRequest = {
  id: number;
  format: 'csv' | 'json';
  fileName: string;
  buffer: ArrayBuffer;
  options: ImportOptions;
};

export type PreviewResponse =
  | {
      id: number;
      ok: true;
      format: 'csv' | 'json';
      needsConfirmation: boolean;
      table: PreviewTable | undefined;
      detected?: { encoding: TextEncoding; delimiter: CsvDelimiter };
      json?: { candidates: string[][]; kind: JsonRootKind };
    }
  | { id: number; ok: false; message: string };
