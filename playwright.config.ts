import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// Os testes de ponta a ponta rodam contra o build de produção (Express servindo o frontend),
// com um banco descartável em .tmp/. Rode `npm run build` antes (o script test:e2e já faz isso).
const PORT = 3100;
const dbFile = path.resolve(import.meta.dirname, '.tmp', 'e2e', 'datakit-e2e.db');
/** Servidor só do painel de métricas (e2e/metrics.spec.ts), com banco e porta próprios. */
const METRICS_PORT = 3101;
const metricsDbFile = path.resolve(import.meta.dirname, '.tmp', 'e2e-metrics', 'metrics-e2e.db');

// Todos os testes saem do mesmo IP: os limites por IP são afrouxados aqui e testados na API.
const relaxedLimits = {
  LIMIT_IMPORTS_PER_HOUR: '10000',
  LIMIT_ACTIVE_SESSIONS_PER_IP: '10000',
  LIMIT_REQUESTS_PER_MINUTE: '100000',
};

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 1 : 0,
  // No CI, cada falha vira uma anotação no GitHub (visível sem baixar os logs).
  reporter: process.env['CI'] ? [['github'], ['list']] : [['list']],
  globalSetup: './e2e/global-setup.ts',
  // Com todos os testes em paralelo, o servidor processa as importações com no máximo 2 workers
  // por vez (de propósito): algumas esperas passam dos 5 s padrão.
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    locale: 'pt-BR',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: [
    {
      command: 'node scripts/e2e-server.mjs',
      url: `http://127.0.0.1:${String(PORT)}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        NODE_ENV: 'test',
        PORT: String(PORT),
        ...relaxedLimits,
        // Prazo depois de fechar a aba encurtado para testar o "fora do prazo" sem esperar 60 s.
        SESSION_DELETE_AFTER_CLOSE_MS: '4000',
        DATABASE_URL: `file:${dbFile.replaceAll('\\', '/')}`,
      },
    },
    {
      // Métricas ligadas, mas fora de produção: tudo é registrado como "dev", nunca como externo.
      command: 'node scripts/e2e-server.mjs',
      url: `http://127.0.0.1:${String(METRICS_PORT)}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        NODE_ENV: 'test',
        PORT: String(METRICS_PORT),
        ...relaxedLimits,
        // Cada teste simula uma origem própria (X-Forwarded-For), como atrás do Nginx; assim o
        // limite de tentativas de login de um teste não afeta os outros.
        TRUST_PROXY: '1',
        METRICS_HMAC_KEY: 'chave-de-teste-e2e-com-mais-de-32-caracteres',
        METRICS_ADMIN_USER: 'admin-e2e',
        METRICS_ADMIN_PASSWORD: 'senha-do-painel-e2e',
        DATABASE_URL: `file:${metricsDbFile.replaceAll('\\', '/')}`,
      },
    },
  ],
});
