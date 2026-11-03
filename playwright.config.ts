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
      DATABASE_URL: `file:${dbFile.replaceAll('\\', '/')}`,
    },
  },
});
