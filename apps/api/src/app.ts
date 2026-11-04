import fs from 'node:fs';
import path from 'node:path';
import express, { type Express } from 'express';
import type { AppConfig } from './config/env.ts';
import type { Db } from './persistence/prisma.ts';
import type { CleanupScheduler } from './services/cleanupService.ts';
import { createMetricsRecorder, type MetricsRecorder } from './metrics/recorder.ts';
import { healthRouter } from './routes/health.ts';
import { metricsRouter } from './routes/metrics.ts';
import { importRouter } from './routes/import.ts';
import { exportRouter } from './routes/export.ts';
import { opsRouter } from './routes/ops.ts';
import { sessionRouter } from './routes/session.ts';
import { generalRateLimit } from './security/rateLimit.ts';
import { securityHeaders } from './security/headers.ts';
import { apiNotFound, errorHandler } from './utils/httpErrors.ts';

export type AppDeps = {
  config: Pick<AppConfig, 'isProduction' | 'trustProxy' | 'webDistDir' | 'limits' | 'metrics'>;
  db: Db;
  /** Registro das métricas de uso; sem ele, é criado a partir de config.metrics. */
  metrics?: MetricsRecorder;
  /** Agendador da limpeza física; ausente em testes que não precisam dele. */
  cleanup?: CleanupScheduler;
};

export function createApp({ config, db, cleanup, metrics: given }: AppDeps): Express {
  const metrics = given ?? createMetricsRecorder(db, config.metrics);
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  app.use(securityHeaders(config.isProduction));

  const api = express.Router();
  api.use(generalRateLimit(config.limits.requestsPerMinute));
  // Operações vêm antes do parser JSON global: têm limite de tamanho próprio.
  api.use(opsRouter(db, metrics));
  api.use(exportRouter(db, metrics));
  api.use(express.json({ limit: '64kb' }));
  api.use(healthRouter(db));
  api.use(metricsRouter(metrics));
  api.use(importRouter(db, config.limits, metrics));
  api.use(sessionRouter(db, { limits: config.limits, cleanup, metrics }));
  api.use(apiNotFound);
  app.use('/api', api);

  // Em produção o Express também serve o build do frontend, na mesma origem (seção 15).
  const indexHtml = path.join(config.webDistDir, 'index.html');
  if (fs.existsSync(indexHtml)) {
    app.use(express.static(config.webDistDir, { index: false, maxAge: '1h' }));
    app.get('/{*path}', (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(indexHtml);
    });
  }

  app.use(errorHandler);
  return app;
}
