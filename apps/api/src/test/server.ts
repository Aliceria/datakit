import fs from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { createApp } from '../app.ts';
import { API_ROOT, DEFAULT_LIMITS, type BusinessLimits } from '../config/env.ts';
import { applyPragmas } from '../persistence/pragmas.ts';
import { createPrisma, type Db } from '../persistence/prisma.ts';
import { startCleanup, type CleanupScheduler } from '../services/cleanupService.ts';
import { createTestDatabase } from './testDb.ts';

export const FIXTURES = path.resolve(API_ROOT, '../../fixtures');

export function fixture(relative: string): Uint8Array {
  return new Uint8Array(fs.readFileSync(path.join(FIXTURES, relative)));
}

export type TestServer = {
  baseUrl: string;
  db: Db;
  /** Arquivo do banco, para conferir que os dados apagados sumiram do disco. */
  dbFile: string;
  cleanup: CleanupScheduler | undefined;
  close: () => Promise<void>;
};

export type TestServerOptions = {
  limits?: Partial<BusinessLimits>;
  /** Liga o agendador de limpeza física (como em produção). */
  withCleanup?: boolean;
};

/** Servidor real numa porta efêmera, com banco temporário só dele. */
export async function startTestServer(options: TestServerOptions = {}): Promise<TestServer> {
  const testDb = createTestDatabase();
  const db = createPrisma(testDb.url);
  await applyPragmas(db);
  const cleanup = options.withCleanup ? startCleanup(db) : undefined;
  const app = createApp({
    config: {
      isProduction: false,
      trustProxy: 0,
      webDistDir: path.join(testDb.dir, 'sem-web'),
      limits: { ...DEFAULT_LIMITS, ...options.limits },
    },
    db,
    ...(cleanup ? { cleanup } : {}),
  });
  const server: Server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  return {
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    db,
    dbFile: testDb.url.slice('file:'.length),
    cleanup,
    close: async () => {
      cleanup?.stop();
      await new Promise<void>((resolve) =>
        server.close(() => {
          resolve();
        }),
      );
      await db.$disconnect();
      testDb.cleanup();
    },
  };
}

export type UploadOptions = {
  sessionId?: string;
  instanceId?: string;
  options?: Record<string, unknown>;
  path?: string;
};

export async function upload(
  server: TestServer,
  fileName: string,
  bytes: Uint8Array,
  opts: UploadOptions = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    'content-type': 'application/octet-stream',
    'x-file-name': encodeURIComponent(fileName),
  };
  if (opts.sessionId) headers['x-session-id'] = opts.sessionId;
  if (opts.instanceId) headers['x-instance-id'] = opts.instanceId;
  if (opts.options) {
    headers['x-import-options'] = Buffer.from(JSON.stringify(opts.options)).toString('base64url');
  }
  return fetch(`${server.baseUrl}${opts.path ?? '/api/import'}`, {
    method: 'POST',
    headers,
    body: bytes,
  });
}
