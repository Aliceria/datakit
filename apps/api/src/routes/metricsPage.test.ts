import fs from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.ts';
import { DEFAULT_LIMITS } from '../config/env.ts';
import { createPrisma, type Db } from '../persistence/prisma.ts';
import { createTestDatabase } from '../test/testDb.ts';

// A página /metrics só existe com usuário e senha do painel configurados.

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
});

async function serve(withLogin: boolean): Promise<string> {
  const testDb = createTestDatabase();
  const webDistDir = path.join(testDb.dir, 'web');
  fs.mkdirSync(webDistDir);
  fs.writeFileSync(path.join(webDistDir, 'index.html'), '<!doctype html><title>Editor</title>');
  fs.writeFileSync(path.join(webDistDir, 'metrics.html'), '<!doctype html><title>Painel</title>');
  const db: Db = createPrisma(testDb.url);
  const app = createApp({
    config: {
      isProduction: false,
      trustProxy: 0,
      webDistDir,
      limits: DEFAULT_LIMITS,
      metrics: {
        hmacKey: undefined,
        retentionDays: 30,
        countExternal: false,
        adminUser: withLogin ? 'admin' : undefined,
        adminPassword: withLogin ? 'senha-do-painel-123' : undefined,
      },
    },
    db,
  });
  const server: Server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  close = async () => {
    await new Promise<void>((resolve) =>
      server.close(() => {
        resolve();
      }),
    );
    await db.$disconnect();
    testDb.cleanup();
  };
  return `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
}

describe('página /metrics', () => {
  it('com usuário e senha, entrega o painel sem cache e sem indexação', async () => {
    const base = await serve(true);
    const res = await fetch(`${base}/metrics`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Painel');
    expect(res.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    // O arquivo só sai pela rota /metrics.
    expect((await fetch(`${base}/metrics.html`)).status).toBe(404);
    // O editor continua igual.
    expect(await (await fetch(`${base}/`)).text()).toContain('Editor');
  });

  it('sem usuário e senha, /metrics não existe', async () => {
    const base = await serve(false);
    const res = await fetch(`${base}/metrics`);
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain('Painel');
    expect((await fetch(`${base}/metrics.html`)).status).toBe(404);
  });
});
