import path from 'node:path';
import { z } from 'zod';
import { LIMITS } from '@datakit/core';

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
});

export type AppConfig = {
  isProduction: boolean;
  host: string;
  port: number;
  databaseUrl: string;
  trustProxy: number;
  webDistDir: string;
  limits: BusinessLimits;
};

export type BusinessLimits = { importsPerHour: number; activeSessionsPerIp: number };

export const DEFAULT_LIMITS: BusinessLimits = {
  importsPerHour: LIMITS.importsPerIpPerHour,
  activeSessionsPerIp: LIMITS.activeSessionsPerIp,
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
    },
  };
}
