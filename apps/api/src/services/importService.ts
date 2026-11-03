import crypto from 'node:crypto';
import { LIMITS, SESSION_TIMING, formatInteger } from '@datakit/core';
import type { Db } from '../persistence/prisma.ts';
import { ApiError } from '../utils/httpErrors.ts';
import type { EncodedDocument, StagedVariants } from '../workers/parseJob.ts';
import { countActiveSessions, createSessionToken } from './sessionService.ts';

const HOUR_MS = 3_600_000;

/** Espaço total do banco (arquivo principal; o WAL é pequeno e é truncado na limpeza). */
async function databaseBytes(db: Db): Promise<number> {
  const [row] = await db.$queryRawUnsafe<Array<{ size: bigint | number }>>(
    'SELECT page_count * page_size AS size FROM pragma_page_count(), pragma_page_size()',
  );
  return Number(row?.size ?? 0);
}

/** Recusa novos uploads quando o banco passa do limite (seção 12). */
export async function assertStorageAvailable(db: Db, limitBytes = LIMITS.maxDatabaseBytes) {
  if ((await databaseBytes(db)) >= limitBytes) {
    throw new ApiError(
      507,
      'STORAGE_FULL',
      'O servidor está sem espaço para novos arquivos no momento. Tente novamente mais tarde.',
    );
  }
}

/** 30 importações por hora por IP (seção 0). Conta e registra numa transação. */
export async function registerImport(db: Db, ip: string, perHour: number): Promise<void> {
  const since = new Date(Date.now() - HOUR_MS);
  const recent = await db.importEvent.count({ where: { ipHash: ip, at: { gt: since } } });
  if (recent >= perHour) {
    throw new ApiError(
      429,
      'IMPORT_LIMIT',
      `Limite de ${formatInteger(perHour)} arquivos abertos por hora atingido. Tente novamente mais tarde.`,
    );
  }
  await db.importEvent.create({ data: { ipHash: ip } });
}

export async function assertCanCreateSession(db: Db, ip: string, max: number): Promise<void> {
  if ((await countActiveSessions(db, ip)) >= max) {
    throw new ApiError(
      429,
      'SESSION_LIMIT',
      `Há ${formatInteger(max)} sessões abertas a partir da sua conexão. Feche alguma aba do DataKit e tente de novo.`,
    );
  }
}

/**
 * Grava o documento como nova versão do snapshot: cria a sessão (sem `sessionId`)
 * ou substitui o conteúdo da sessão existente (seção 6.1). Histórico e log recomeçam.
 */
export async function saveDocument(
  db: Db,
  params: {
    sessionId?: string;
    ip: string;
    /** Instância (carregamento de página) que fez a importação; passa a ser a ativa. */
    instanceId?: string | undefined;
    document: EncodedDocument;
    sourceMeta: string;
  },
): Promise<{ token?: string; sessionId: string; version: number }> {
  const { document } = params;
  const bytesUsed =
    document.manifestGz.byteLength + document.chunks.reduce((s, c) => s + c.data.byteLength, 0);

  if (params.sessionId) {
    const sessionId = params.sessionId;
    const version = await db.$transaction(async (tx) => {
      const current = await tx.session.findUniqueOrThrow({
        where: { id: sessionId },
        select: { snapshotVersion: true },
      });
      const next = current.snapshotVersion + 1;
      await tx.opLog.deleteMany({ where: { sessionId } });
      await tx.snapshotChunk.deleteMany({ where: { sessionId } });
      await tx.snapshotManifest.deleteMany({ where: { sessionId } });
      await writeSnapshot(tx, sessionId, next, document);
      await tx.session.update({
        where: { id: sessionId },
        data: {
          snapshotVersion: next,
          snapshotSeq: 0,
          headSeq: 0,
          sourceMeta: params.sourceMeta,
          exportState: '{}',
          bytesUsed,
          lastSeenAt: new Date(),
          ...(params.instanceId ? { activeInstanceId: params.instanceId } : {}),
        },
      });
      return next;
    });
    return { sessionId, version };
  }

  const { token, id } = createSessionToken();
  const now = new Date();
  await db.$transaction(async (tx) => {
    await tx.session.create({
      data: {
        id,
        ipHash: params.ip,
        expiresAt: new Date(now.getTime() + SESSION_TIMING.maxDurationMs),
        lastSeenAt: now,
        snapshotVersion: 1,
        activeInstanceId: params.instanceId ?? null,
        sourceMeta: params.sourceMeta,
        bytesUsed,
      },
    });
    await writeSnapshot(tx, id, 1, document);
  });
  return { token, sessionId: id, version: 1 };
}

type Tx = Parameters<Parameters<Db['$transaction']>[0]>[0];

async function writeSnapshot(tx: Tx, sessionId: string, version: number, doc: EncodedDocument) {
  await tx.snapshotManifest.create({
    data: { sessionId, version, data: toBytes(doc.manifestGz) },
  });
  if (doc.chunks.length > 0) {
    await tx.snapshotChunk.createMany({
      data: doc.chunks.map((c) => ({
        sessionId,
        version,
        tableId: c.tableId,
        chunkIndex: c.index,
        data: toBytes(c.data),
      })),
    });
  }
}

const toBytes = (data: Uint8Array): Uint8Array<ArrayBuffer> => new Uint8Array(data);

// ---------------------------------------------------------------------------------------------
// Área de espera do XLSX (L3): guarda o documento já processado nas duas variantes de cabeçalho,
// nunca o arquivo bruto. Fica só na memória, por poucos minutos.

const STAGE_TTL_MS = 5 * 60_000;
const MAX_STAGED = 20;

type Staged = {
  ip: string;
  expiresAt: number;
  fileName: string;
  variants: StagedVariants;
};

const staged = new Map<string, Staged>();

function pruneStaged(now = Date.now()): void {
  for (const [id, entry] of staged) if (entry.expiresAt <= now) staged.delete(id);
}

export function putStaged(entry: Omit<Staged, 'expiresAt'>): string {
  pruneStaged();
  if (staged.size >= MAX_STAGED) {
    throw new ApiError(503, 'BUSY', 'O servidor está ocupado. Tente novamente em instantes.');
  }
  const id = crypto.randomBytes(16).toString('base64url');
  staged.set(id, { ...entry, expiresAt: Date.now() + STAGE_TTL_MS });
  return id;
}

/** Retira da área de espera (uso único). Só o mesmo IP pode confirmar. */
export function takeStaged(id: string, ip: string): Staged {
  pruneStaged();
  const entry = staged.get(id);
  if (!entry || entry.ip !== ip) {
    throw new ApiError(
      410,
      'STAGE_EXPIRED',
      'A pré-visualização expirou. Abra o arquivo novamente.',
    );
  }
  staged.delete(id);
  return entry;
}
