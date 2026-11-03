import zlib from 'node:zlib';
import {
  ImportError,
  assertCellLimit,
  assertTableLimits,
  buildPreview,
  createFormatRegistry,
  csvReader,
  encodeDocument,
  formatInteger,
  jsonReader,
  promoteHeaderRow,
  type DataDocument,
  type ImportOptions,
  type ImportWarning,
  type PreviewTable,
} from '@datakit/core';
import { xlsxReader } from '../formats/xlsx/xlsxReader.ts';

// Trabalho executado dentro do worker thread: parsing, montagem e compactação do snapshot.
// Separado do arquivo do worker para poder ser testado sem thread.

export const registry = createFormatRegistry([csvReader, xlsxReader, jsonReader]);

export type EncodedDocument = {
  manifestGz: Uint8Array;
  chunks: Array<{ tableId: string; index: number; data: Uint8Array }>;
  summary: ImportSummary;
};

export type ImportSummary = {
  warnings: ImportWarning[];
  tables: Array<{ id: string; name: string; rows: number; columns: number; hidden: boolean }>;
  sizeBytes: number;
};

export type ParseRequest =
  | { kind: 'import'; bytes: Uint8Array; fileName: string; options: ImportOptions }
  | { kind: 'stage'; bytes: Uint8Array; fileName: string };

export type StagedVariants = {
  withHeader: EncodedDocument;
  withoutHeader: EncodedDocument;
  preview: { withHeader: PreviewTable[]; withoutHeader: PreviewTable[] };
};

export type ParseResponse =
  | { ok: true; kind: 'import'; document: EncodedDocument }
  | { ok: true; kind: 'stage'; staged: StagedVariants }
  | { ok: false; error: { code: string; message: string } };

const gzip = (value: unknown): Uint8Array =>
  zlib.gzipSync(JSON.stringify(value), { level: zlib.constants.Z_BEST_SPEED });

function encode(doc: DataDocument): EncodedDocument {
  for (const table of doc.tables) {
    assertTableLimits(
      doc.tables.length > 1 ? table.name : '',
      table.rowOrder.length,
      table.columns.length,
    );
  }
  assertCellLimit(doc.tables.reduce((s, t) => s + t.rowOrder.length * t.columns.length, 0));

  const { manifest, chunks } = encodeDocument(doc);
  return {
    manifestGz: gzip(manifest),
    chunks: chunks.map((c) => ({ tableId: c.tableId, index: c.index, data: gzip(c.payload) })),
    summary: {
      warnings: doc.warnings,
      tables: manifest.tables.map((t) => ({
        id: t.id,
        name: t.name,
        rows: t.stats.rows,
        columns: t.stats.columns,
        hidden: t.hidden,
      })),
      sizeBytes: doc.source.sizeBytes,
    },
  };
}

/** XLSX: o leitor não aplica cabeçalho; aqui ele é promovido quando pedido. */
function applyXlsxHeader(doc: DataDocument): void {
  let renamed = 0;
  for (const table of doc.tables) renamed += promoteHeaderRow(table).renamed;
  doc.source.hasHeader = true;
  if (renamed > 0) {
    doc.warnings.push({
      code: 'HEADERS_RENAMED',
      message: `${formatInteger(renamed)} nomes de coluna vazios ou repetidos foram ajustados (ex.: "coluna_3", "nome (2)").`,
    });
  }
}

export async function runParse(request: ParseRequest): Promise<ParseResponse> {
  try {
    const reader = registry.forFileName(request.fileName);
    if (!reader) {
      throw new ImportError('UNSUPPORTED_FORMAT', 'Formato não suportado.');
    }
    const input = {
      bytes: request.bytes,
      fileName: request.fileName,
      options: request.kind === 'import' ? request.options : {},
    };

    if (request.kind === 'stage') {
      // Monta as duas variantes (com e sem cabeçalho) para a confirmação não precisar do arquivo bruto.
      const doc = await reader.read(input);
      const withoutHeaderPreview = doc.tables.map((t) => buildPreview(t));
      const withoutHeader = encode(doc);
      applyXlsxHeader(doc);
      const withHeaderPreview = doc.tables.map((t) => buildPreview(t));
      const withHeader = encode(doc);
      return {
        ok: true,
        kind: 'stage',
        staged: {
          withHeader,
          withoutHeader,
          preview: { withHeader: withHeaderPreview, withoutHeader: withoutHeaderPreview },
        },
      };
    }

    const doc = await reader.read(input);
    if (reader.descriptor.id === 'xlsx' && (request.options.hasHeader ?? true)) {
      applyXlsxHeader(doc);
    }
    return { ok: true, kind: 'import', document: encode(doc) };
  } catch (err) {
    if (err instanceof ImportError) {
      return { ok: false, error: { code: err.code, message: err.message } };
    }
    return {
      ok: false,
      error: { code: 'INTERNAL', message: 'Erro inesperado ao ler o arquivo.' },
    };
  }
}
