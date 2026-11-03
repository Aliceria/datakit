import type { Db } from '../persistence/prisma.ts';
import { log } from '../utils/log.ts';
import { parseInWorker } from '../workers/pool.ts';
import { reclaimSpace } from './cleanupService.ts';
import { logId } from './sessionService.ts';

// Compactação (docs/PLANO.md, 4.4): a cada N operações, o snapshot avança até a cabeça do log.
// A versão anterior fica guardada até a próxima compactação, para que um navegador que esteja
// baixando o snapshot naquele instante termine sem erro. O log anterior a ela é apagado.

export const COMPACT_EVERY_OPS = 200;

/** Compactação em andamento por sessão: quem pedir de novo espera a mesma. */
const running = new Map<string, Promise<boolean>>();
/** Cabeça do log em que a compactação falhou: não tenta de novo até chegarem operações novas. */
const failedAt = new Map<string, number>();

export function scheduleCompaction(
  db: Db,
  sessionId: string,
  headSeq: number,
  snapshotSeq: number,
): void {
  if (headSeq - snapshotSeq < COMPACT_EVERY_OPS) return;
  if (running.has(sessionId) || failedAt.get(sessionId) === headSeq) return;
  void compactSession(db, sessionId);
}

export function compactSession(db: Db, sessionId: string): Promise<boolean> {
  const current = running.get(sessionId);
  if (current) return current;
  const job = runCompaction(db, sessionId).finally(() => {
    running.delete(sessionId);
  });
  running.set(sessionId, job);
  return job;
}

async function runCompaction(db: Db, sessionId: string): Promise<boolean> {
  try {
    const session = await db.session.findUnique({
      where: { id: sessionId },
      select: { snapshotVersion: true, snapshotSeq: true, headSeq: true },
    });
    if (!session || session.headSeq <= session.snapshotSeq) return false;
    const { snapshotVersion: version, snapshotSeq, headSeq } = session;

    const [manifest, chunks, ops] = await Promise.all([
      db.snapshotManifest.findUniqueOrThrow({
        where: { sessionId_version: { sessionId, version } },
      }),
      db.snapshotChunk.findMany({
        where: { sessionId, version },
        select: { tableId: true, data: true },
      }),
      db.opLog.findMany({
        where: { sessionId, seq: { gt: snapshotSeq, lte: headSeq } },
        orderBy: { seq: 'asc' },
        select: { payload: true },
      }),
    ]);

    const result = await parseInWorker({
      kind: 'compact',
      manifestGz: manifest.data,
      chunks: chunks.map((c) => ({ tableId: c.tableId, data: c.data })),
      ops: ops.map((o) => o.payload),
    });
    if (!result.ok || result.kind !== 'import') {
      failedAt.set(sessionId, headSeq);
      log.error('compactação falhou', {
        session: logId(sessionId),
        error: result.ok ? 'resposta inesperada' : result.error.message,
      });
      return false;
    }
    const doc = result.document;
    const next = version + 1;
    const bytesUsed =
      doc.manifestGz.byteLength + doc.chunks.reduce((s, c) => s + c.data.byteLength, 0);

    await db.$transaction(async (tx) => {
      // A sessão pode ter sido apagada ou substituída (nova importação) durante a compactação.
      const current = await tx.session.findUnique({
        where: { id: sessionId },
        select: { snapshotVersion: true },
      });
      if (current?.snapshotVersion !== version) return;
      await tx.snapshotManifest.create({
        data: { sessionId, version: next, seq: headSeq, data: new Uint8Array(doc.manifestGz) },
      });
      if (doc.chunks.length > 0) {
        await tx.snapshotChunk.createMany({
          data: doc.chunks.map((c) => ({
            sessionId,
            version: next,
            tableId: c.tableId,
            chunkIndex: c.index,
            data: new Uint8Array(c.data),
          })),
        });
      }
      await tx.session.update({
        where: { id: sessionId },
        data: { snapshotVersion: next, snapshotSeq: headSeq, bytesUsed },
      });
      // Guarda a versão anterior; apaga as mais antigas e o log que só elas usavam.
      await tx.snapshotChunk.deleteMany({ where: { sessionId, version: { lt: version } } });
      await tx.snapshotManifest.deleteMany({ where: { sessionId, version: { lt: version } } });
      await tx.opLog.deleteMany({ where: { sessionId, seq: { lte: manifest.seq } } });
    });
    failedAt.delete(sessionId);
    await reclaimSpace(db);
    return true;
  } catch (err) {
    log.error('compactação falhou', {
      session: logId(sessionId),
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
