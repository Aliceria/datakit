import fs from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { createApp } from '../app.ts';
import { API_ROOT, DEFAULT_LIMITS } from '../config/env.ts';
import { applyPragmas } from '../persistence/pragmas.ts';
import { createPrisma, type Db } from '../persistence/prisma.ts';
import { createTestDatabase } from './testDb.ts';

export const FIXTURES = path.resolve(API_ROOT, '../../fixtures');

export function fixture(relative: string): Uint8Array {
  return new Uint8Array(fs.readFileSync(path.join(FIXTURES, relative)));
}

export type TestServer = {
  baseUrl: string;
  db: Db;
  close: () => Promise<void>;
};

/** Servidor real numa porta efêmera, com banco temporário só dele. */
export async function startTestServer(): Promise<TestServer> {
  const testDb = createTestDatabase();
  const db = createPrisma(testDb.url);
  await applyPragmas(db);
  const app = createApp({
    config: {
      isProduction: false,
      trustProxy: 0,
      webDistDir: path.join(testDb.dir, 'sem-web'),
      limits: DEFAULT_LIMITS,
    },
    db,
  });
  const server: Server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  return {
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    db,
    close: async () => {
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
  if (opts.options) {
    headers['x-import-options'] = Buffer.from(JSON.stringify(opts.options)).toString('base64url');
  }
  return fetch(`${server.baseUrl}${opts.path ?? '/api/import'}`, {
    method: 'POST',
    headers,
    body: bytes,
  });
}
