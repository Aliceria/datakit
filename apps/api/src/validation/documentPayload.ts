import { z } from 'zod';
import { LIMITS } from '@datakit/core';

// Documento enviado pelo navegador para "Continuar em uma nova sessão" (L14).
// É o mesmo formato do snapshot (manifesto + blocos). Os dados são do próprio usuário, mas a
// estrutura é validada com rigor: nada de chaves inesperadas, tamanhos coerentes, limites da seção 0.

const MAX_ROW_ID = 10_000_000;
const columnId = z.string().regex(/^c\d{1,6}$/);
const tableId = z.string().regex(/^t\d{1,4}$/);

const column = z
  .object({
    id: columnId,
    name: z.string().max(10_000),
    path: z.array(z.string().max(10_000)).max(LIMITS.jsonMaxDepth).optional(),
    pathOccurrences: z.array(z.number().int().min(0)).max(LIMITS.jsonMaxDepth).optional(),
  })
  .strict();

const tableManifest = z
  .object({
    id: tableId,
    name: z.string().max(1000),
    hidden: z.boolean(),
    columns: z.array(column).max(LIMITS.maxColumnsPerTable),
    rowOrder: z.array(z.number().int().min(0).max(MAX_ROW_ID)).max(LIMITS.maxRowsPerTable),
    nextRowId: z.number().int().min(0).max(MAX_ROW_ID),
    nextColId: z.number().int().min(0).max(1_000_000),
    // Estatísticas e inferência são recalculadas no servidor; o que vier é ignorado.
    chunks: z.array(z.number().int().min(0)),
    stats: z.unknown(),
    inference: z.unknown(),
  })
  .strict();

const source = z
  .object({
    fileName: z.string().min(1).max(255),
    extension: z.string().max(16),
    format: z.enum(['csv', 'xlsx', 'json']),
    sizeBytes: z.number().int().min(0),
    importedAt: z.string().max(40),
    hasHeader: z.boolean(),
    encoding: z.enum(['utf-8', 'utf-8-bom', 'windows-1252']).optional(),
    delimiter: z.enum([',', ';', '\t', '|']).optional(),
    jsonRootPath: z.array(z.string().max(1000)).max(LIMITS.jsonMaxDepth).optional(),
    date1904: z.boolean().optional(),
  })
  .strict();

const chunkColumn = z
  .object({
    s: z.string().regex(/^[vna]*$/),
    r: z.array(z.string().nullable()),
    t: z.string().regex(/^[0-6]*$/),
    x: z
      .record(z.string(), z.object({ formula: z.string().max(10_000).optional() }).strict())
      .optional(),
  })
  .strict()
  .refine((c) => c.s.length === c.r.length && c.s.length === c.t.length, 'tamanhos diferentes');

const chunk = z
  .object({
    tableId,
    index: z.number().int().min(0),
    payload: z
      .object({
        rowIds: z.array(z.number().int().min(0).max(MAX_ROW_ID)),
        cols: z.record(columnId, chunkColumn),
      })
      .strict(),
  })
  .strict();

export const documentPayloadSchema = z
  .object({
    manifest: z
      .object({
        formatVersion: z.literal(1),
        source,
        warnings: z.array(z.object({ code: z.string(), message: z.string() }).strict()).max(100),
        tables: z.array(tableManifest).min(1).max(1000),
        // Restauração começa um log novo, sem histórico de desfazer; as marcas de alteração
        // ("não exportadas") são mantidas.
        snapshotSeq: z.literal(0).optional(),
        history: z
          .object({ undo: z.tuple([]), redo: z.tuple([]) })
          .strict()
          .optional(),
        marks: z
          .object({
            changes: z.number().int().min(0),
            tables: z.record(
              tableId,
              z
                .object({
                  cells: z.array(z.string().regex(/^d{1,8}:cd{1,7}$/)).max(3_100_000),
                  rows: z.array(z.number().int().min(0)).max(1_000_000),
                  cols: z.array(columnId).max(1000),
                })
                .strict(),
            ),
          })
          .strict()
          .optional(),
      })
      .strict(),
    chunks: z.array(chunk),
  })
  .strict();

export type DocumentPayload = z.infer<typeof documentPayloadSchema>;
