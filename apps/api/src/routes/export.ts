import express, { Router } from 'express';
import { z } from 'zod';
import type { ExportRequest } from '@datakit/core';
import type { Db } from '../persistence/prisma.ts';
import { logId, requireSession } from '../services/sessionService.ts';
import { ApiError } from '../utils/httpErrors.ts';
import { log } from '../utils/log.ts';
import { parseInWorker } from '../workers/pool.ts';

// Exportação (seção 10.3). Só começa quando o servidor já tem todas as operações que o navegador
// fez (headSeq = expectedSeq). O arquivo é gerado num worker, a partir do snapshot + log.
// Montada antes do parser JSON global: a lista de linhas visíveis pode ter 100.000 IDs.
const exportJson = express.json({ limit: '4mb' });

const MAX_ROWS = 100_000;
const tableId = z.string().regex(/^t\d{1,4}$/);
const delimiter = z.enum([',', ';', '\t', '|']);

const options = z.discriminatedUnion('format', [
  z
    .object({
      format: z.literal('csv'),
      delimiter,
      header: z.boolean(),
      bom: z.boolean(),
      formulaGuard: z.boolean(),
    })
    .strict(),
  z
    .object({
      format: z.literal('xlsx'),
      allSheets: z.boolean(),
      header: z.boolean(),
      nativeTypes: z.boolean(),
    })
    .strict(),
  z
    .object({
      format: z.literal('json'),
      shape: z.enum(['objects', 'arrays']),
      nested: z.boolean(),
      indent: z.boolean(),
    })
    .strict(),
]);

const bodySchema = z
  .object({
    expectedSeq: z.number().int().min(0),
    fileName: z.string().min(1).max(200),
    tableIds: z.array(tableId).min(1).max(1000),
    rowIds: z.array(z.number().int().min(0).max(10_000_000)).max(MAX_ROWS).optional(),
    options,
  })
  .strict();

const MIME: Record<ExportRequest['options']['format'], string> = {
  csv: 'text/csv; charset=utf-8',
  json: 'application/json; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

/** Nome de arquivo seguro para o cabeçalho: ASCII em filename e UTF-8 em filename* (RFC 6266). */
export function contentDisposition(fileName: string): string {
  // Sem separadores de caminho nem caracteres de controle.
  // eslint-disable-next-line no-control-regex
  const clean = fileName.replace(/[\u0000-\u001f\u007f/\\]/g, '_').trim() || 'dados';
  const ascii = clean
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/["%;]/g, '_');
  const encoded = encodeURIComponent(clean).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

export function exportRouter(db: Db): Router {
  const router = Router();

  router.post('/session/export', exportJson, async (req, res, next) => {
    try {
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) throw new ApiError(400, 'BAD_REQUEST', 'Pedido de exportação inválido.');
      const body = parsed.data;
      const session = await requireSession(db, req);
      if (session.headSeq !== body.expectedSeq) {
        throw new ApiError(
          409,
          'NOT_SYNCED',
          'Ainda há alterações sendo salvas. Tente de novo em instantes.',
          { headSeq: session.headSeq },
        );
      }
      const { snapshotVersion: version, snapshotSeq, headSeq } = session;
      const [manifest, chunks, ops] = await Promise.all([
        db.snapshotManifest.findUniqueOrThrow({
          where: { sessionId_version: { sessionId: session.id, version } },
        }),
        db.snapshotChunk.findMany({
          where: { sessionId: session.id, version },
          select: { tableId: true, data: true },
        }),
        db.opLog.findMany({
          where: { sessionId: session.id, seq: { gt: snapshotSeq, lte: headSeq } },
          orderBy: { seq: 'asc' },
          select: { payload: true },
        }),
      ]);
      const request: ExportRequest = {
        tableIds: body.tableIds,
        options: body.options,
        fileName: body.fileName,
        ...(body.rowIds ? { rowIds: body.rowIds } : {}),
      };
      const result = await parseInWorker({
        kind: 'export',
        request,
        manifestGz: manifest.data,
        chunks: chunks.map((c) => ({ tableId: c.tableId, data: c.data })),
        ops: ops.map((o) => o.payload),
      });
      if (!result.ok) {
        const status = result.error.code === 'EXPORT_CONFLICT' ? 422 : 500;
        if (status === 500) {
          log.error('exportação falhou', {
            session: logId(session.id),
            error: result.error.message,
          });
        }
        throw new ApiError(status, result.error.code, result.error.message);
      }
      if (result.kind !== 'export') throw new ApiError(500, 'INTERNAL', 'Resposta inesperada.');
      res.set({
        'Content-Type': MIME[body.options.format],
        'Content-Disposition': contentDisposition(body.fileName),
        'Content-Length': String(result.bytes.byteLength),
        'Cache-Control': 'no-store',
      });
      res.end(Buffer.from(result.bytes.buffer, result.bytes.byteOffset, result.bytes.byteLength));
    } catch (err) {
      next(err);
    }
  });

  return router;
}
