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
  tableFromManifest,
  applyChunk,
  LIMITS,
  type CellExtras,
  type ChunkPayload,
  type Column,
  type DataDocument,
  type ImportOptions,
  type ImportWarning,
  type PreviewTable,
} from '@datakit/core';
import { xlsxReader } from '../formats/xlsx/xlsxReader.ts';
import { documentPayloadSchema, type DocumentPayload } from '../validation/documentPayload.ts';

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
  fileName: string;
};

export type ParseRequest =
  | { kind: 'import'; bytes: Uint8Array; fileName: string; options: ImportOptions }
  | { kind: 'stage'; bytes: Uint8Array; fileName: string }
  | { kind: 'restore'; bytes: Uint8Array };

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
      fileName: doc.source.fileName,
    },
  };
}

/** Teto da descompactação do documento enviado para restaurar uma sessão (L14). */
const RESTORE_MAX_BYTES = 512 * 1024 * 1024;

const invalidRestore = () =>
  new ImportError('INVALID_FILE', 'Os dados enviados para continuar a sessão são inválidos.');

/**
 * "Continuar em uma nova sessão" (L14): o navegador manda o documento que tem na memória, no
 * formato do snapshot, compactado. Valida a estrutura, remonta as tabelas e recalcula inferência
 * e estatísticas (o que veio do navegador nesses campos é descartado).
 */
function rebuildDocument(bytes: Uint8Array): DataDocument {
  let json: unknown;
  try {
    json = JSON.parse(
      zlib.gunzipSync(bytes, { maxOutputLength: RESTORE_MAX_BYTES }).toString('utf8'),
    );
  } catch {
    throw invalidRestore();
  }
  const parsed = documentPayloadSchema.safeParse(json);
  if (!parsed.success) throw invalidRestore();
  const { manifest, chunks } = parsed.data;

  const tables = manifest.tables.map((tm) => {
    if (tm.rowOrder.some((id) => id >= tm.nextRowId)) throw invalidRestore();
    if (new Set(tm.rowOrder).size !== tm.rowOrder.length) throw invalidRestore();
    const columns: Column[] = tm.columns.map((c) => ({
      id: c.id,
      name: c.name,
      ...(c.path ? { path: c.path } : {}),
      ...(c.pathOccurrences ? { pathOccurrences: c.pathOccurrences } : {}),
    }));
    if (new Set(columns.map((c) => c.id)).size !== columns.length) throw invalidRestore();
    if (tm.nextRowId > LIMITS.maxRowsPerTable * 10) throw invalidRestore();
    return tableFromManifest({ ...tm, columns });
  });
  for (const chunk of chunks) {
    const table = tables.find((t) => t.id === chunk.tableId);
    if (!table || chunk.payload.rowIds.some((id) => id >= table.nextRowId)) throw invalidRestore();
    for (const col of Object.values(chunk.payload.cols)) {
      if (col.s.length !== chunk.payload.rowIds.length) throw invalidRestore();
    }
    try {
      applyChunk(table, toChunkPayload(chunk.payload));
    } catch {
      throw invalidRestore();
    }
  }
  const { source } = manifest;
  return {
    source: {
      fileName: source.fileName,
      extension: source.extension,
      format: source.format,
      sizeBytes: source.sizeBytes,
      importedAt: source.importedAt,
      hasHeader: source.hasHeader,
      ...(source.encoding ? { encoding: source.encoding } : {}),
      ...(source.delimiter ? { delimiter: source.delimiter } : {}),
      ...(source.jsonRootPath ? { jsonRootPath: source.jsonRootPath } : {}),
      ...(source.date1904 ? { date1904: source.date1904 } : {}),
    },
    tables,
    warnings: [],
  };
}

type ValidatedChunk = DocumentPayload['chunks'][number]['payload'];

/** Tira os `undefined` explícitos que o zod produz (exactOptionalPropertyTypes). */
function toChunkPayload(payload: ValidatedChunk): ChunkPayload {
  const cols: ChunkPayload['cols'] = {};
  for (const [id, col] of Object.entries(payload.cols)) {
    const x: Record<string, CellExtras> = {};
    for (const [i, extras] of Object.entries(col.x ?? {})) {
      x[i] = extras.formula === undefined ? {} : { formula: extras.formula };
    }
    cols[id] = { s: col.s, r: col.r, t: col.t, ...(col.x ? { x } : {}) };
  }
  return { rowIds: payload.rowIds, cols };
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
    if (request.kind === 'restore') {
      return { ok: true, kind: 'import', document: encode(rebuildDocument(request.bytes)) };
    }
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
