import { Router } from 'express';
import { z } from 'zod';
import type { Db } from '../persistence/prisma.ts';
import { findActiveSession, logId, requireSession } from '../services/sessionService.ts';
import { ApiError } from '../utils/httpErrors.ts';
import { log } from '../utils/log.ts';

const chunkParams = z.object({
  tableId: z.string().regex(/^t\d{1,4}$/),
  chunkIndex: z.coerce.number().int().min(0).max(1_000_000),
});

export function sessionRouter(db: Db): Router {
  const router = Router();

  // Manifesto do snapshot atual (gzip pronto, servido sem recompactar).
  router.get('/session/manifest', async (req, res, next) => {
    try {
      const session = await requireSession(db, req);
      const manifest = await db.snapshotManifest.findUnique({
        where: {
          sessionId_version: { sessionId: session.id, version: session.snapshotVersion },
        },
      });
      if (!manifest) throw new ApiError(404, 'NOT_FOUND', 'Nenhum arquivo aberto nesta sessão.');
      res.set({
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Encoding': 'gzip',
        'Cache-Control': 'no-store',
        'X-Snapshot-Version': String(session.snapshotVersion),
      });
      res.send(Buffer.from(manifest.data));
    } catch (err) {
      next(err);
    }
  });

  router.get('/session/chunks/:tableId/:chunkIndex', async (req, res, next) => {
    try {
      const params = chunkParams.safeParse(req.params);
      if (!params.success) throw new ApiError(400, 'BAD_REQUEST', 'Requisição inválida.');
      const session = await requireSession(db, req);
      // Toda consulta é filtrada pela sessão (seção 12).
      const chunk = await db.snapshotChunk.findUnique({
        where: {
          sessionId_version_tableId_chunkIndex: {
            sessionId: session.id,
            version: session.snapshotVersion,
            tableId: params.data.tableId,
            chunkIndex: params.data.chunkIndex,
          },
        },
      });
      if (!chunk) throw new ApiError(404, 'NOT_FOUND', 'Bloco de dados não encontrado.');
      res.set({
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Encoding': 'gzip',
        'Cache-Control': 'no-store',
      });
      res.send(Buffer.from(chunk.data));
    } catch (err) {
      next(err);
    }
  });

  // Fechar o arquivo pelo "×": apaga a sessão na hora.
  router.delete('/session', async (req, res, next) => {
    try {
      const session = await findActiveSession(db, req);
      if (session) {
        await db.session.delete({ where: { id: session.id } });
        log.info('sessão encerrada pelo usuário', { session: logId(session.id) });
      }
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
