import { SESSION_TIMING } from '@datakit/core';
import type { Db } from '../persistence/prisma.ts';
import { log } from '../utils/log.ts';

const HOUR_MS = 3_600_000;

/**
 * Exclusão de verdade (seção 5.2): apaga as sessões vencidas em cascata e libera o espaço.
 * - secure_delete (ligado na inicialização) zera as páginas apagadas;
 * - incremental_vacuum devolve as páginas livres ao sistema de arquivos;
 * - wal_checkpoint(TRUNCATE) leva tudo ao arquivo principal e esvazia o WAL, que também guarda
 *   cópias de páginas.
 * SQL bruto: o Prisma não tem API para PRAGMA.
 */
export async function purgeExpiredSessions(db: Db, now = new Date()): Promise<number> {
  const expired = await db.session.findMany({
    where: {
      OR: [
        { deleteAt: { lte: now } },
        { lastSeenAt: { lte: new Date(now.getTime() - SESSION_TIMING.inactivityMs) } },
        { expiresAt: { lte: now } },
      ],
    },
    select: { id: true },
  });

  if (expired.length > 0) {
    await db.session.deleteMany({ where: { id: { in: expired.map((s) => s.id) } } });
  }
  // Registros de importação só servem para o limite por hora.
  await db.importEvent.deleteMany({ where: { at: { lte: new Date(now.getTime() - HOUR_MS) } } });

  if (expired.length > 0) {
    await reclaimSpace(db);
    log.info('sessões apagadas', { count: expired.length });
  }
  return expired.length;
}

export async function reclaimSpace(db: Db): Promise<void> {
  await db.$queryRawUnsafe('PRAGMA incremental_vacuum');
  await db.$queryRawUnsafe('PRAGMA wal_checkpoint(TRUNCATE)');
}

export type CleanupScheduler = {
  /** Agenda uma limpeza logo depois do horário de exclusão de uma sessão. */
  scheduleAt(date: Date): void;
  runNow(): Promise<number>;
  stop(): void;
};

/** Roda ao iniciar, a cada 5 minutos e no vencimento de cada exclusão agendada. */
export function startCleanup(db: Db): CleanupScheduler {
  let running: Promise<number> | undefined;
  const timers = new Set<NodeJS.Timeout>();

  const runNow = async (): Promise<number> => {
    // Uma limpeza por vez; quem chega durante uma em andamento espera a mesma.
    running ??= purgeExpiredSessions(db).finally(() => {
      running = undefined;
    });
    try {
      return await running;
    } catch (err) {
      log.error('falha na limpeza de sessões', {
        error: err instanceof Error ? err.message : String(err),
      });
      return 0;
    }
  };

  const interval = setInterval(() => void runNow(), SESSION_TIMING.cleanupIntervalMs);
  interval.unref();
  void runNow();

  return {
    scheduleAt: (date) => {
      const timer = setTimeout(
        () => {
          timers.delete(timer);
          void runNow();
        },
        Math.max(0, date.getTime() - Date.now()) + 250,
      );
      timer.unref();
      timers.add(timer);
    },
    runNow,
    stop: () => {
      clearInterval(interval);
      timers.forEach((t) => {
        clearTimeout(t);
      });
      timers.clear();
    },
  };
}
