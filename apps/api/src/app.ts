import fs from 'node:fs';
import path from 'node:path';
import express, { type Express } from 'express';
import type { AppConfig } from './config/env.ts';
import type { Db } from './persistence/prisma.ts';
import { healthRouter } from './routes/health.ts';
import { generalRateLimit } from './security/rateLimit.ts';
import { securityHeaders } from './security/headers.ts';
import { apiNotFound, errorHandler } from './utils/httpErrors.ts';

export type AppDeps = {
  config: Pick<AppConfig, 'isProduction' | 'trustProxy' | 'webDistDir'>;
  db: Db;
};

export function createApp({ config, db }: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  app.use(securityHeaders(config.isProduction));

  const api = express.Router();
  api.use(generalRateLimit());
  api.use(express.json({ limit: '64kb' }));
  api.use(healthRouter(db));
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
