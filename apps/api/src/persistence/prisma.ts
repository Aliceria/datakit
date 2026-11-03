import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '../generated/prisma/client.ts';

export type Db = InstanceType<typeof PrismaClient>;

/** Cria o cliente Prisma ligado ao SQLite pelo adaptador do better-sqlite3 (exigido no Prisma 7). */
export function createPrisma(databaseUrl: string): Db {
  const adapter = new PrismaBetterSqlite3({ url: databaseUrl.replace(/^file:/, '') });
  return new PrismaClient({ adapter });
}
