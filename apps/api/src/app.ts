import fs from 'node:fs';
import path from 'node:path';
import express, { type Express } from 'express';
import type { AppConfig } from './config/env.ts';
import type { Db } from './persistence/prisma.ts';
import type { CleanupScheduler } from './services/cleanupService.ts';
import { createMetricsRecorder, type MetricsRecorder } from './metrics/recorder.ts';
import { healthRouter } from './routes/health.ts';
import { metricsRouter } from './routes/metrics.ts';
import { metricsAdminRouter } from './routes/metricsAdmin.ts';
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
  api.use(metricsAdminRouter({ db, config: config.metrics, secureCookie: config.isProduction }));
  api.use(importRouter(db, config.limits, metrics));
  api.use(sessionRouter(db, { limits: config.limits, cleanup, metrics }));
  api.use(apiNotFound);
  app.use('/api', api);

  // Em produção o Express também serve o build do frontend, na mesma origem (seção 15).
  const indexHtml = path.join(config.webDistDir, 'index.html');
  if (fs.existsSync(indexHtml)) {
    // Painel de métricas: só existe com usuário e senha configurados; sem eles, 404. A página
    // não traz dados: os números vêm de /api/metrics/admin/*, que exige login.
    const metricsHtml = path.join(config.webDistDir, 'metrics.html');
    const panelEnabled = Boolean(config.metrics.adminUser && config.metrics.adminPassword);
    app.get('/metrics', (_req, res, next) => {
      if (!panelEnabled || !fs.existsSync(metricsHtml)) {
        next();
        return;
      }
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('X-Robots-Tag', 'noindex, nofollow');
      res.sendFile(metricsHtml);
    });
    // O arquivo só é servido pela rota acima.
    app.get(['/metrics', '/metrics.html'], (_req, res) => {
      res.status(404).type('text/plain; charset=utf-8').send('Página não encontrada.');
    });
    app.use(express.static(config.webDistDir, { index: false, maxAge: '1h' }));
    app.get('/{*path}', (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(indexHtml);
    });
  }

  app.use(errorHandler);
  return app;
}
