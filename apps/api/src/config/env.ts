import path from 'node:path';
import { z } from 'zod';

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
});

export type AppConfig = {
  isProduction: boolean;
  host: string;
  port: number;
  databaseUrl: string;
  trustProxy: number;
  webDistDir: string;
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
  };
}
