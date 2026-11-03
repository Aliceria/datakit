import type { Db } from './prisma.ts';

// SQL bruto: o Prisma não tem API para PRAGMA. Justificativa em docs/DECISOES.md.

type PragmaRow = Record<string, unknown>;

async function readPragma(db: Db, name: string): Promise<unknown> {
  const rows = await db.$queryRawUnsafe<PragmaRow[]>(`PRAGMA ${name}`);
  const first = rows[0];
  return first ? Object.values(first)[0] : undefined;
}

export type PragmaState = {
  journalMode: string;
  autoVacuum: number;
  secureDelete: number;
  foreignKeys: number;
};

/**
 * Configura o banco na inicialização:
 * - WAL (seção 3.2);
 * - secure_delete e auto_vacuum incremental, para a exclusão liberar e zerar o espaço (seção 5.2);
 * - chaves estrangeiras (exclusão em cascata das sessões).
 */
export async function applyPragmas(db: Db): Promise<PragmaState> {
  await db.$queryRawUnsafe('PRAGMA journal_mode = WAL');
  await db.$executeRawUnsafe('PRAGMA foreign_keys = ON');
  await db.$executeRawUnsafe('PRAGMA secure_delete = ON');
  await db.$executeRawUnsafe('PRAGMA busy_timeout = 5000');

  // auto_vacuum só muda de NONE para INCREMENTAL com um VACUUM completo, fora de transação.
  // As migrations criam o banco antes de este código rodar, então a conversão acontece uma vez aqui.
  if (Number(await readPragma(db, 'auto_vacuum')) !== 2) {
    await db.$executeRawUnsafe('PRAGMA auto_vacuum = INCREMENTAL');
    await db.$executeRawUnsafe('VACUUM');
  }

  return readPragmaState(db);
}

export async function readPragmaState(db: Db): Promise<PragmaState> {
  return {
    journalMode: String(await readPragma(db, 'journal_mode')),
    autoVacuum: Number(await readPragma(db, 'auto_vacuum')),
    secureDelete: Number(await readPragma(db, 'secure_delete')),
    foreignKeys: Number(await readPragma(db, 'foreign_keys')),
  };
}
