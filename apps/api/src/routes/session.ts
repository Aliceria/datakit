import express, { Router, type Request } from 'express';
import { z } from 'zod';
import type { BusinessLimits } from '../config/env.ts';
import type { Db } from '../persistence/prisma.ts';
import { reclaimSpace, type CleanupScheduler } from '../services/cleanupService.ts';
import { assertCanCreateSession } from '../services/importService.ts';
import {
  findActiveSession,
  findActiveSessionById,
  forkSession,
  hashToken,
  heartbeat,
  ipHash,
  isValidInstanceId,
  isValidToken,
  logId,
  releaseSession,
  requireSession,
  resumeSession,
  type ActiveSession,
} from '../services/sessionService.ts';
import { appendOps } from '../services/opService.ts';
import { asLogOp, logOpSchema } from '../validation/opsPayload.ts';
import { ApiError } from '../utils/httpErrors.ts';
import { log } from '../utils/log.ts';

const chunkParams = z.object({
  tableId: z.string().regex(/^t\d{1,4}$/),
  chunkIndex: z.coerce.number().int().min(0).max(1_000_000),
});

const instanceBody = z.object({ instanceId: z.string().refine(isValidInstanceId) }).strict();

const releaseBody = z
  .object({
    sid: z.string().refine(isValidToken),
    instanceId: z.string().refine(isValidInstanceId),
    // Operações ainda não enviadas que couberam no beacon (até ~64 KB).
    ops: z.array(logOpSchema).max(1000).optional(),
  })
  .strict();

/** Operações do beacon: só da instância ativa; falhas são ignoradas (a fila do navegador reenvia). */
async function appendReleasedOps(db: Db, body: z.infer<typeof releaseBody>): Promise<void> {
  try {
    const session = await findActiveSessionById(db, hashToken(body.sid));
    if (!session || session.activeInstanceId !== body.instanceId || !body.ops) return;
    await appendOps(db, session.id, body.ops.map(asLogOp));
  } catch {
    // Reenviadas depois pela fila guardada no sessionStorage.
  }
}

function parseInstance(body: unknown): string {
  const parsed = instanceBody.safeParse(body);
  if (!parsed.success) throw new ApiError(400, 'BAD_REQUEST', 'Requisição inválida.');
  return parsed.data.instanceId;
}

/** O que o navegador precisa para montar a sessão depois de retomar ou copiar. */
const sessionState = (
  session: Pick<ActiveSession, 'snapshotVersion' | 'snapshotSeq' | 'headSeq' | 'expiresAt'>,
) => ({
  snapshotVersion: session.snapshotVersion,
  snapshotSeq: session.snapshotSeq,
  headSeq: session.headSeq,
  expiresAt: session.expiresAt.toISOString(),
});

/**
 * Versão do snapshot pedida em ?v=. Vale a atual ou a anterior (que a compactação guarda por uma
 * rodada), para quem começou a baixar antes de uma compactação terminar.
 */
function requestedVersion(req: Request, session: ActiveSession): number {
  const v = Number(req.query['v']);
  if (Number.isInteger(v) && (v === session.snapshotVersion || v === session.snapshotVersion - 1)) {
    return v;
  }
  return session.snapshotVersion;
}

export type SessionRouterDeps = { limits: BusinessLimits; cleanup: CleanupScheduler | undefined };

export function sessionRouter(db: Db, deps: SessionRouterDeps): Router {
  const router = Router();

  router.get('/session/state', async (req, res, next) => {
    try {
      res.json(sessionState(await requireSession(db, req)));
    } catch (err) {
      next(err);
    }
  });

  // F5, reabrir a aba fechada ou voltar pelo bfcache (seção 5.3).
  router.post('/session/resume', async (req, res, next) => {
    try {
      const instanceId = parseInstance(req.body);
      const session = await requireSession(db, req);
      await resumeSession(db, session, instanceId);
      res.json(sessionState(session));
    } catch (err) {
      next(err);
    }
  });

  // pagehide: o beacon não envia cabeçalhos, então o token vem no corpo (text/plain).
  // Sempre 204: a resposta não revela se o token existe.
  router.post(
    '/session/release',
    express.text({ type: 'text/plain', limit: '64kb' }),
    async (req, res, next) => {
      try {
        let body: unknown;
        try {
          body = typeof req.body === 'string' ? JSON.parse(req.body) : undefined;
        } catch {
          body = undefined;
        }
        const parsed = releaseBody.safeParse(body);
        if (parsed.success) {
          if (parsed.data.ops?.length) await appendReleasedOps(db, parsed.data);
          const deleteAt = await releaseSession(
            db,
            parsed.data.sid,
            parsed.data.instanceId,
            deps.limits.deleteAfterCloseMs,
          );
          if (deleteAt) deps.cleanup?.scheduleAt(deleteAt);
        }
        res.status(204).end();
      } catch (err) {
        next(err);
      }
    },
  );

  router.post('/session/heartbeat', async (req, res, next) => {
    try {
      const instanceId = parseInstance(req.body);
      const session = await requireSession(db, req);
      await heartbeat(db, session, instanceId);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  // "Duplicar aba" ou instância substituída: cópia independente (seção 5.3).
  router.post('/session/fork', async (req, res, next) => {
    try {
      const instanceId = parseInstance(req.body);
      const source = await requireSession(db, req);
      const ip = ipHash(req);
      await assertCanCreateSession(db, ip, deps.limits.activeSessionsPerIp);
      const { token, id } = await forkSession(db, source.id, { ip, instanceId });
      log.info('sessão copiada', { from: logId(source.id), to: logId(id) });
      res.status(201).json({ sessionId: token, ...sessionState(source) });
    } catch (err) {
      next(err);
    }
  });

  // Manifesto do snapshot atual (gzip pronto, servido sem recompactar).
  router.get('/session/manifest', async (req, res, next) => {
    try {
      const session = await requireSession(db, req);
      const manifest = await db.snapshotManifest.findUnique({
        where: {
          sessionId_version: { sessionId: session.id, version: requestedVersion(req, session) },
        },
      });
      if (!manifest) throw new ApiError(404, 'NOT_FOUND', 'Nenhum arquivo aberto nesta sessão.');
      res.set({
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Encoding': 'gzip',
        'Cache-Control': 'no-store',
        'X-Snapshot-Version': String(requestedVersion(req, session)),
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
            version: requestedVersion(req, session),
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
        await reclaimSpace(db);
        log.info('sessão encerrada pelo usuário', { session: logId(session.id) });
      }
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
