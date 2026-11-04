import path from 'node:path';
import { z } from 'zod';
import { LIMITS, SESSION_TIMING } from '@datakit/core';
import type { MetricsConfig } from '../metrics/recorder.ts';

// Raiz de apps/api, tanto rodando de src/ (desenvolvimento) quanto de dist/ (produção).
export const API_ROOT = path.resolve(import.meta.dirname, '../..');
const REPO_ROOT = path.resolve(API_ROOT, '../..');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(0).max(65_535).default(3000),
  DATABASE_URL: z
    .string()
    .startsWith('file:', 'DATABASE_URL precisa começar com "file:"')
    .default(`file:${path.join(REPO_ROOT, 'data', 'datakit.db').replaceAll('\\', '/')}`),
  // Quantos proxies reversos confiáveis existem na frente do Express (Nginx = 1).
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
  WEB_DIST_DIR: z.string().default(path.join(REPO_ROOT, 'apps', 'web', 'dist')),
  // Limites por IP (seção 0). Ajustáveis para redes com NAT (R8) e para os testes de ponta a ponta.
  LIMIT_IMPORTS_PER_HOUR: z.coerce.number().int().min(1).default(LIMITS.importsPerIpPerHour),
  LIMIT_ACTIVE_SESSIONS_PER_IP: z.coerce.number().int().min(1).default(LIMITS.activeSessionsPerIp),
  // Limite genérico de requisições por IP por minuto, contra enxurrada (seção 12).
  LIMIT_REQUESTS_PER_MINUTE: z.coerce.number().int().min(10).default(600),
  // Espaço máximo do banco; acima dele, novos uploads são recusados (seção 12).
  LIMIT_DATABASE_BYTES: z.coerce.number().int().min(1).default(LIMITS.maxDatabaseBytes),
  // Métricas de uso (painel /metrics). Sem a chave, nada é registrado.
  METRICS_HMAC_KEY: z
    .string()
    .min(32, 'METRICS_HMAC_KEY precisa ter pelo menos 32 caracteres')
    .optional(),
  // Usuário e senha do painel /metrics. Sem os dois, o painel não existe (404).
  METRICS_ADMIN_USER: z.string().min(1).max(200).optional(),
  METRICS_ADMIN_PASSWORD: z
    .string()
    .min(12, 'METRICS_ADMIN_PASSWORD precisa ter pelo menos 12 caracteres')
    .max(200)
    .optional(),
  // Dias até apagar o HMAC e o IP mascarado; no máximo 30.
  METRICS_RETENTION_DAYS: z.coerce.number().int().min(1).max(30).default(30),
  // Prazo entre fechar a aba e apagar a sessão (seção 0). Encurtado só nos testes de ponta a ponta.
  SESSION_DELETE_AFTER_CLOSE_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .default(SESSION_TIMING.deleteAfterCloseMs),
});

export type AppConfig = {
  isProduction: boolean;
  host: string;
  port: number;
  databaseUrl: string;
  trustProxy: number;
  webDistDir: string;
  limits: BusinessLimits;
  metrics: MetricsConfig;
};

/** Limites e prazos da seção 0 que a API aplica; ajustáveis por variável de ambiente. */
export type BusinessLimits = {
  importsPerHour: number;
  activeSessionsPerIp: number;
  deleteAfterCloseMs: number;
  requestsPerMinute: number;
  maxDatabaseBytes: number;
};

export const DEFAULT_LIMITS: BusinessLimits = {
  importsPerHour: LIMITS.importsPerIpPerHour,
  activeSessionsPerIp: LIMITS.activeSessionsPerIp,
  deleteAfterCloseMs: SESSION_TIMING.deleteAfterCloseMs,
  requestsPerMinute: 600,
  maxDatabaseBytes: LIMITS.maxDatabaseBytes,
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`Configuração inválida:\n${problems.join('\n')}`);
  }
  const e = parsed.data;
  return {
    isProduction: e.NODE_ENV === 'production',
    host: e.HOST,
    port: e.PORT,
    databaseUrl: e.DATABASE_URL,
    trustProxy: e.TRUST_PROXY,
    webDistDir: e.WEB_DIST_DIR,
    limits: {
      importsPerHour: e.LIMIT_IMPORTS_PER_HOUR,
      activeSessionsPerIp: e.LIMIT_ACTIVE_SESSIONS_PER_IP,
      deleteAfterCloseMs: e.SESSION_DELETE_AFTER_CLOSE_MS,
      requestsPerMinute: e.LIMIT_REQUESTS_PER_MINUTE,
      maxDatabaseBytes: e.LIMIT_DATABASE_BYTES,
    },
    metrics: {
      hmacKey: e.METRICS_HMAC_KEY,
      retentionDays: e.METRICS_RETENTION_DAYS,
      countExternal: e.NODE_ENV === 'production',
      adminUser: e.METRICS_ADMIN_USER,
      adminPassword: e.METRICS_ADMIN_PASSWORD,
    },
  };
}
