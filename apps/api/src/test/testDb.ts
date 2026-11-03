import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { API_ROOT } from '../config/env.ts';

/**
 * Cria um banco SQLite temporário com as migrations aplicadas, como o `prisma migrate deploy` faria.
 * Aplica os arquivos SQL direto para os testes não dependerem da CLI do Prisma.
 */
export function createTestDatabase(): { url: string; dir: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'datakit-test-'));
  const file = path.join(dir, 'test.db');
  const migrationsDir = path.join(API_ROOT, 'prisma', 'migrations');
  const migrations = fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const sqlite = new Database(file);
  try {
    for (const name of migrations) {
      sqlite.exec(fs.readFileSync(path.join(migrationsDir, name, 'migration.sql'), 'utf8'));
    }
  } finally {
    sqlite.close();
  }

  return {
    url: `file:${file.replaceAll('\\', '/')}`,
    dir,
    cleanup: () => {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
