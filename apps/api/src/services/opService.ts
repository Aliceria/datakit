import zlib from 'node:zlib';
import type { LogOp } from '@datakit/core';
import type { Db } from '../persistence/prisma.ts';
import { ApiError } from '../utils/httpErrors.ts';

// Log de operações (docs/PLANO.md, seção 5.4): cada operação tem número de sequência e ID.
// - seq == head + 1: grava;
// - seq <= head com o mesmo opId: repetição (reenvio depois de F5 ou falha de rede), ignora;
// - seq <= head com outro opId: conflito → o navegador ressincroniza;
// - seq > head + 1: lacuna → o navegador reenvia a partir de head + 1.

const gzip = (value: unknown): Uint8Array<ArrayBuffer> =>
  new Uint8Array(zlib.gzipSync(JSON.stringify(value), { level: zlib.constants.Z_BEST_SPEED }));

export type AppendResult = {
  ackedSeq: number;
  added: number;
  /** Operações gravadas agora (sem as repetições), para as métricas de uso. */
  addedOps: LogOp[];
};

export async function appendOps(
  db: Db,
  sessionId: string,
  ops: readonly LogOp[],
): Promise<AppendResult> {
  const sorted = [...ops].sort((a, b) => a.seq - b.seq);
  return db.$transaction(async (tx) => {
    const session = await tx.session.findUniqueOrThrow({
      where: { id: sessionId },
      select: { headSeq: true },
    });
    let head = session.headSeq;
    let added = 0;
    const addedOps: LogOp[] = [];
    for (const op of sorted) {
      if (op.seq <= head) {
        const existing = await tx.opLog.findUnique({
          where: { sessionId_seq: { sessionId, seq: op.seq } },
          select: { opId: true },
        });
        if (existing?.opId === op.opId) continue;
        throw new ApiError(409, 'SEQ_CONFLICT', 'As alterações desta aba divergiram do servidor.', {
          headSeq: head,
        });
      }
      if (op.seq !== head + 1) {
        throw new ApiError(409, 'SEQ_GAP', 'Faltam alterações anteriores.', { headSeq: head });
      }
      const duplicateId = await tx.opLog.findUnique({
        where: { sessionId_opId: { sessionId, opId: op.opId } },
        select: { seq: true },
      });
      if (duplicateId) {
        throw new ApiError(409, 'SEQ_CONFLICT', 'As alterações desta aba divergiram do servidor.', {
          headSeq: head,
        });
      }
      await tx.opLog.create({ data: { sessionId, seq: op.seq, opId: op.opId, payload: gzip(op) } });
      head = op.seq;
      added += 1;
      addedOps.push(op);
    }
    if (added > 0) {
      await tx.session.update({
        where: { id: sessionId },
        data: { headSeq: head, lastSeenAt: new Date() },
      });
    }
    return { ackedSeq: head, added, addedOps };
  });
}

/**
 * Operações depois de `after`, em ordem, como um array JSON compactado (para o navegador
 * reaplicar depois do F5). Se o começo já foi compactado, o navegador precisa recomeçar a carga.
 */
export async function readOpsAfter(db: Db, sessionId: string, after: number): Promise<Buffer> {
  const rows = await db.opLog.findMany({
    where: { sessionId, seq: { gt: after } },
    orderBy: { seq: 'asc' },
    select: { seq: true, payload: true },
  });
  if (rows.length > 0 && rows[0]?.seq !== after + 1) {
    throw new ApiError(409, 'OPS_COMPACTED', 'O estado mudou; carregue de novo.');
  }
  const parts = rows.map((r) => zlib.gunzipSync(r.payload).toString('utf8'));
  return zlib.gzipSync(`[${parts.join(',')}]`, { level: zlib.constants.Z_BEST_SPEED });
}
