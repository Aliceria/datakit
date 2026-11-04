import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.ts';
import { DEFAULT_LIMITS } from './config/env.ts';
import { applyPragmas, readPragmaState } from './persistence/pragmas.ts';
import { createPrisma, type Db } from './persistence/prisma.ts';
import { createTestDatabase } from './test/testDb.ts';

let db: Db;
let server: Server;
let baseUrl: string;
let cleanup: () => void;

beforeAll(async () => {
  const testDb = createTestDatabase();
  cleanup = testDb.cleanup;

  // Build falso do frontend para conferir que o Express serve a SPA.
  const webDistDir = path.join(testDb.dir, 'web');
  fs.mkdirSync(webDistDir);
  fs.writeFileSync(path.join(webDistDir, 'index.html'), '<!doctype html><title>DataKit</title>');

  db = createPrisma(testDb.url);
  await applyPragmas(db);
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
        adminUser: undefined,
        adminPassword: undefined,
      },
    },
    db,
  });
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) =>
    server.close(() => {
      resolve();
    }),
  );
  await db.$disconnect();
  cleanup();
});

describe('banco', () => {
  it('usa WAL, auto_vacuum incremental, secure_delete e chaves estrangeiras', async () => {
    expect(await readPragmaState(db)).toEqual({
      journalMode: 'wal',
      autoVacuum: 2,
      secureDelete: 1,
      foreignKeys: 1,
    });
  });

  it('aplicar os pragmas de novo não muda nada', async () => {
    const again = await applyPragmas(db);
    expect(again.autoVacuum).toBe(2);
    expect(again.journalMode).toBe('wal');
  });
});

describe('GET /api/health', () => {
  it('responde ok com o banco acessível', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ status: 'ok', db: 'ok' });
    expect(typeof body['version']).toBe('string');
  });
});

describe('cabeçalhos de segurança', () => {
  it('envia CSP restritiva e esconde o Express', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    const csp = res.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("style-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain('unsafe-inline');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-powered-by')).toBeNull();
  });
});

describe('erros', () => {
  it('rota inexistente da API devolve JSON em português, sem stack trace', async () => {
    const res = await fetch(`${baseUrl}/api/nao-existe`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.message).toBe('Endereço da API não encontrado.');
    expect(JSON.stringify(body)).not.toMatch(/at .*\.ts/);
  });

  it('JSON malformado devolve 400 sem detalhes internos', async () => {
    const res = await fetch(`${baseUrl}/api/health`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"a":',
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('BAD_REQUEST');
  });

  it('corpo acima do limite devolve 413', async () => {
    const res = await fetch(`${baseUrl}/api/health`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ x: 'a'.repeat(70 * 1024) }),
    });
    expect(res.status).toBe(413);
  });
});

describe('frontend', () => {
  it('serve o index.html para rotas fora da API', async () => {
    const res = await fetch(`${baseUrl}/qualquer/caminho`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<title>DataKit</title>');
  });
});
