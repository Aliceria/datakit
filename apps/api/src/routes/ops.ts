import express, { Router } from 'express';
import { z } from 'zod';
import type { Db } from '../persistence/prisma.ts';
import { scheduleCompaction } from '../services/compactionService.ts';
import { appendOps, readOpsAfter } from '../services/opService.ts';
import {
  assertActiveInstance,
  isValidInstanceId,
  requireSession,
} from '../services/sessionService.ts';
import { asLogOp, opsBodySchema } from '../validation/opsPayload.ts';
import { ApiError } from '../utils/httpErrors.ts';

// Rotas do log de operações. Montadas antes do parser JSON global (64 KB): uma colagem grande
// pode ter dezenas de MB. O navegador manda o corpo compactado (Content-Encoding: gzip).
const opsJson = express.json({ limit: '64mb', inflate: true });

const afterQuery = z.object({ after: z.coerce.number().int().min(0) });

export function opsRouter(db: Db): Router {
  const router = Router();

  router.post('/session/ops', opsJson, async (req, res, next) => {
    try {
      const parsed = opsBodySchema.safeParse(req.body);
      if (!parsed.success || !isValidInstanceId(parsed.data.instanceId)) {
        throw new ApiError(422, 'INVALID_OP', 'Operação inválida.');
      }
      const session = await requireSession(db, req);
      await assertActiveInstance(db, session, parsed.data.instanceId);
      const result = await appendOps(db, session.id, parsed.data.ops.map(asLogOp));
      scheduleCompaction(db, session.id, result.ackedSeq, session.snapshotSeq);
      res.json({ ackedSeq: result.ackedSeq });
    } catch (err) {
      next(err);
    }
  });

  router.get('/session/ops', async (req, res, next) => {
    try {
      const query = afterQuery.safeParse(req.query);
      if (!query.success) throw new ApiError(400, 'BAD_REQUEST', 'Requisição inválida.');
      const session = await requireSession(db, req);
      const body = await readOpsAfter(db, session.id, query.data.after);
      res.set({
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Encoding': 'gzip',
        'Cache-Control': 'no-store',
      });
      res.send(body);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
