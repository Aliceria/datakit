import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const coreSource = fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url));

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'core',
          root: './packages/core',
          include: ['src/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        resolve: { alias: { '@datakit/core': coreSource } },
        test: {
          name: 'api',
          root: './apps/api',
          include: ['src/**/*.test.ts'],
          environment: 'node',
          env: { NODE_ENV: 'test' },
          // Os worker threads do parsing rodam o código-fonte do core.
          execArgv: ['--conditions=source'],
          testTimeout: 30_000,
        },
      },
    ],
  },
});
