import type { Db } from '../persistence/prisma.ts';
import { DEDUP_WINDOW_MS } from './recorder.ts';

// Retenção das métricas: depois de N dias (padrão 30), o HMAC da origem, o IP mascarado e o hash
// da sessão são apagados. Os registros continuam nos totais, sem identificação. Antes disso, o
// número de origens distintas de cada dia é guardado em MetricsDaily.

const DAY_MS = 86_400_000;
/** São Paulo está em UTC−3 o ano inteiro desde 2019 (sem horário de verão). */
const SAO_PAULO_OFFSET_MS = 3 * 3_600_000;
/** Uma sessão vive no máximo 24 h; o vínculo sessão → arquivo pode sair depois de 2 dias. */
const SESSION_LINK_MS = 2 * DAY_MS;

/** Dia no fuso de São Paulo, como aaaa-mm-dd. */
export function saoPauloDay(date: Date): string {
  return new Date(date.getTime() - SAO_PAULO_OFFSET_MS).toISOString().slice(0, 10);
}

/** Início do dia (aaaa-mm-dd, São Paulo) em UTC. */
export function saoPauloDayStart(day: string): Date {
  return new Date(Date.parse(`${day}T00:00:00Z`) + SAO_PAULO_OFFSET_MS);
}

/**
 * Guarda as origens distintas de cada dia já terminado cujos registros ainda estão inteiros (com
 * HMAC). Pode rodar várias vezes: recalcula o mesmo número.
 */
export async function rollupDaily(db: Db, retentionDays: number, now = new Date()): Promise<void> {
  const cutoff = now.getTime() - retentionDays * DAY_MS;
  const today = saoPauloDayStart(saoPauloDay(now)).getTime();
  for (let start = today - DAY_MS; start >= cutoff; start -= DAY_MS) {
    const from = new Date(start);
    const to = new Date(start + DAY_MS);
    const day = saoPauloDay(from);
    const rows = await db.metricsVisit.findMany({
      where: { at: { gte: from, lt: to }, originHmac: { not: null } },
      distinct: ['originHmac', 'classification'],
      select: { classification: true },
    });
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r.classification, (counts.get(r.classification) ?? 0) + 1);
    for (const [classification, distinctOrigins] of counts) {
      await db.metricsDaily.upsert({
        where: { day_classification: { day, classification } },
        create: { day, classification, distinctOrigins },
        update: { distinctOrigins },
      });
    }
  }
}

export async function purgeMetrics(db: Db, retentionDays: number, now = new Date()): Promise<void> {
  await rollupDaily(db, retentionDays, now);
  const cutoff = new Date(now.getTime() - retentionDays * DAY_MS);
  const anonymize = { originHmac: null, maskedIp: null };
  const old = { at: { lt: cutoff } };
  await db.metricsVisit.updateMany({
    where: { ...old, OR: [{ originHmac: { not: null } }, { maskedIp: { not: null } }] },
    data: anonymize,
  });
  const withSession = { ...anonymize, sessionHash: null };
  const oldWithIds = {
    ...old,
    OR: [
      { originHmac: { not: null } },
      { maskedIp: { not: null } },
      { sessionHash: { not: null } },
    ],
  };
  await db.metricsImport.updateMany({ where: oldWithIds, data: withSession });
  await db.metricsEdit.updateMany({ where: oldWithIds, data: withSession });
  await db.metricsExport.updateMany({ where: oldWithIds, data: withSession });
  // A deduplicação só precisa dos últimos 10 minutos.
  await db.metricsOriginLast.deleteMany({
    where: { lastCountedAt: { lt: BigInt(now.getTime() - DEDUP_WINDOW_MS) } },
  });
  await db.metricsSession.deleteMany({
    where: { createdAt: { lt: new Date(now.getTime() - SESSION_LINK_MS) } },
  });
  await db.metricsAdminSession.deleteMany({ where: { expiresAt: { lte: now } } });
}
