import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// Os testes de ponta a ponta rodam contra o build de produção (Express servindo o frontend),
// com um banco descartável em .tmp/. Rode `npm run build` antes (o script test:e2e já faz isso).
const PORT = 3100;
const dbFile = path.resolve(import.meta.dirname, '.tmp', 'e2e', 'datakit-e2e.db');

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 1 : 0,
  reporter: [['list']],
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
  webServer: {
    command: 'node scripts/e2e-server.mjs',
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      NODE_ENV: 'test',
      PORT: String(PORT),
      // Todos os testes saem do mesmo IP: os limites por IP são afrouxados aqui e testados na API.
      LIMIT_IMPORTS_PER_HOUR: '10000',
      LIMIT_ACTIVE_SESSIONS_PER_IP: '10000',
      LIMIT_REQUESTS_PER_MINUTE: '100000',
      // Prazo depois de fechar a aba encurtado para testar o "fora do prazo" sem esperar 60 s.
      SESSION_DELETE_AFTER_CLOSE_MS: '4000',
      DATABASE_URL: `file:${dbFile.replaceAll('\\', '/')}`,
    },
  },
});
