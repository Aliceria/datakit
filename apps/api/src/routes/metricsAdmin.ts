import crypto from 'node:crypto';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import {
  ADMIN_COOKIE,
  hashAdminToken,
  isAdminRequest,
  readCookie,
} from '../metrics/adminSession.ts';
import {
  EVENT_TYPES,
  PERIODS,
  eventHistory,
  reportCsv,
  summary,
  visitHistory,
} from '../metrics/queries.ts';
import type { MetricsConfig } from '../metrics/recorder.ts';
import type { Db } from '../persistence/prisma.ts';
import { ApiError } from '../utils/httpErrors.ts';
import { log } from '../utils/log.ts';

// Painel /metrics: login com usuário e senha do .env e consultas dos números. O DataKit não tem
// contas; só o painel tem acesso protegido. Sem usuário e senha configurados, nada disto existe.

/** Validade do login do painel. */
export const ADMIN_SESSION_MS = 12 * 3_600_000;
/** Tentativas erradas de login por origem a cada 15 minutos. */
export const LOGIN_ATTEMPTS = 5;

const loginBody = z
  .object({ user: z.string().min(1).max(200), password: z.string().min(1).max(200) })
  .strict();

const classification = z.enum(['external', 'admin', 'dev']).optional();
const page = z.coerce.number().int().min(1).max(100_000).default(1);

const summaryQuery = z.object({
  period: z.enum(PERIODS).default('30d'),
  view: z.enum(['community', 'admin']).default('community'),
});
const visitsQuery = z.object({ page, classification });
const eventsQuery = z.object({
  page,
  classification,
  type: z.enum(EVENT_TYPES).optional(),
  format: z.enum(['csv', 'xlsx', 'json', 'outro']).optional(),
  ok: z.enum(['true', 'false']).optional(),
});
const reportQuery = summaryQuery.extend({ format: z.enum(['csv', 'json']).default('json') });

/** Compara em tempo constante: os dois lados viram SHA-256 do mesmo tamanho. */
function sameSecret(given: string, expected: string): boolean {
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

function cookieAttributes(secure: boolean, maxAgeSeconds: number): string {
  return [
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${String(maxAgeSeconds)}`,
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ApiError(400, 'BAD_REQUEST', 'Requisição inválida.');
  return parsed.data;
}

export type MetricsAdminDeps = {
  db: Db;
  config: MetricsConfig;
  /** Cookie com Secure só em produção (os testes rodam em http, como o HSTS). */
  secureCookie: boolean;
};

export function metricsAdminRouter({ db, config, secureCookie }: MetricsAdminDeps): Router {
  const router = Router();
  const { adminUser, adminPassword } = config;
  // Sem usuário e senha, o painel não existe: as rotas caem no 404 da API.
  if (!adminUser || !adminPassword) return router;

  router.use('/metrics/admin', (_req, res, next) => {
    // Nada do painel fica em cache nem é indexado.
    res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' });
    next();
  });

  const loginLimit = rateLimit({
    windowMs: 15 * 60_000,
    limit: LOGIN_ATTEMPTS,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, _res, next) => {
      next(
        new ApiError(
          429,
          'TOO_MANY_ATTEMPTS',
          'Muitas tentativas de login. Aguarde 15 minutos e tente de novo.',
        ),
      );
    },
  });

  router.post('/metrics/admin/login', loginLimit, async (req, res, next) => {
    try {
      const body = parse(loginBody, req.body);
      // As duas comparações sempre rodam, para o tempo não revelar qual campo errou.
      const userOk = sameSecret(body.user, adminUser);
      const passwordOk = sameSecret(body.password, adminPassword);
      if (!userOk || !passwordOk) {
        log.warn('login do painel recusado');
        throw new ApiError(401, 'BAD_LOGIN', 'Usuário ou senha incorretos.');
      }
      const token = crypto.randomBytes(32).toString('base64url');
      await db.metricsAdminSession.create({
        data: {
          tokenHash: hashAdminToken(token),
          expiresAt: new Date(Date.now() + ADMIN_SESSION_MS),
        },
      });
      res.setHeader(
        'Set-Cookie',
        `${ADMIN_COOKIE}=${token}; ${cookieAttributes(secureCookie, ADMIN_SESSION_MS / 1000)}`,
      );
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  router.post('/metrics/admin/logout', async (req, res, next) => {
    try {
      const token = readCookie(req, ADMIN_COOKIE);
      if (token) {
        await db.metricsAdminSession.deleteMany({ where: { tokenHash: hashAdminToken(token) } });
      }
      res.setHeader('Set-Cookie', `${ADMIN_COOKIE}=; ${cookieAttributes(secureCookie, 0)}`);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  // Daqui para baixo, só com login.
  const requireAdmin = (req: Request, _res: Response, next: NextFunction) => {
    isAdminRequest(db, req).then(
      (ok) => {
        next(ok ? undefined : new ApiError(401, 'NOT_LOGGED_IN', 'Faça login no painel.'));
      },
      (err: unknown) => {
        next(err);
      },
    );
  };

  router.get('/metrics/admin/me', requireAdmin, (_req, res) => {
    res.json({ retentionDays: config.retentionDays, recording: config.hmacKey !== undefined });
  });

  router.get('/metrics/admin/summary', requireAdmin, async (req, res, next) => {
    try {
      const q = parse(summaryQuery, req.query);
      res.json(await summary(db, q.period, q.view));
    } catch (err) {
      next(err);
    }
  });

  router.get('/metrics/admin/visits', requireAdmin, async (req, res, next) => {
    try {
      const q = parse(visitsQuery, req.query);
      res.json(
        await visitHistory(db, {
          page: q.page,
          classification: q.classification,
          retentionDays: config.retentionDays,
        }),
      );
    } catch (err) {
      next(err);
    }
  });

  router.get('/metrics/admin/events', requireAdmin, async (req, res, next) => {
    try {
      const q = parse(eventsQuery, req.query);
      res.json(
        await eventHistory(db, {
          page: q.page,
          type: q.type,
          classification: q.classification,
          format: q.format,
          ok: q.ok === undefined ? undefined : q.ok === 'true',
          retentionDays: config.retentionDays,
        }),
      );
    } catch (err) {
      next(err);
    }
  });

  router.get('/metrics/admin/report', requireAdmin, async (req, res, next) => {
    try {
      const q = parse(reportQuery, req.query);
      const s = await summary(db, q.period, q.view);
      const name = `datakit-metricas-${q.period}.${q.format}`;
      res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
      if (q.format === 'csv') {
        res.type('text/csv; charset=utf-8').send(reportCsv(s));
      } else {
        res.type('application/json; charset=utf-8').send(`${JSON.stringify(s, null, 2)}\n`);
      }
    } catch (err) {
      next(err);
    }
  });

  return router;
}
