import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { API_ROOT } from '../config/env.ts';
import type { Db } from '../persistence/prisma.ts';
import { log } from '../utils/log.ts';

const pkg = JSON.parse(fs.readFileSync(path.join(API_ROOT, 'package.json'), 'utf8')) as {
  version: string;
};

export function healthRouter(db: Db): Router {
  const router = Router();
  router.get('/health', async (_req, res) => {
    try {
      await db.$queryRawUnsafe('SELECT 1');
      res.json({ status: 'ok', db: 'ok', version: pkg.version });
    } catch (err) {
      log.error('health: banco indisponível', {
        error: err instanceof Error ? err.message : String(err),
      });
      res.status(503).json({ status: 'error', db: 'error', version: pkg.version });
    }
  });
  return router;
}
