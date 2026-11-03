import crypto from 'node:crypto';
import type { Request } from 'express';
import { SESSION_TIMING } from '@datakit/core';
import type { Db } from '../persistence/prisma.ts';
import { ApiError } from '../utils/httpErrors.ts';

export const SESSION_HEADER = 'x-session-id';
export const INSTANCE_HEADER = 'x-instance-id';
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const INSTANCE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Token aleatório de 256 bits. Só o hash vai para o banco (é uma credencial). */
export function createSessionToken(): { token: string; id: string } {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, id: hashToken(token) };
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** IP como hash: suficiente para os limites, sem guardar o endereço (seção 12). */
export function ipHash(req: Request): string {
  return crypto
    .createHash('sha256')
    .update(`datakit-ip:${req.ip ?? 'desconhecido'}`)
    .digest('hex');
}

/** Prefixo curto para logs: nunca o ID completo (seção 12). */
export const logId = (id: string): string => id.slice(0, 8);

export const SESSION_EXPIRED_MESSAGE =
  'Sessão expirada. Os dados temporários foram apagados; abra o arquivo novamente.';

export const INSTANCE_REPLACED_MESSAGE =
  'Esta sessão foi aberta em outra aba. Esta aba vai continuar com uma cópia independente.';

export const isValidToken = (value: unknown): value is string =>
  typeof value === 'string' && TOKEN_PATTERN.test(value);

export const isValidInstanceId = (value: unknown): value is string =>
  typeof value === 'string' && INSTANCE_PATTERN.test(value);

export function readToken(req: Request): string | undefined {
  const value = req.header(SESSION_HEADER);
  return isValidToken(value) ? value : undefined;
}

/** ID do carregamento de página (UUID gerado no navegador a cada carga). */
export function readInstanceId(req: Request): string | undefined {
  const value = req.header(INSTANCE_HEADER);
  return isValidInstanceId(value) ? value : undefined;
}

type ExpiryFields = { expiresAt: Date; lastSeenAt: Date; deleteAt: Date | null };

export function isExpired(session: ExpiryFields, now = new Date()): boolean {
  return (
    session.expiresAt <= now ||
    session.lastSeenAt.getTime() + SESSION_TIMING.inactivityMs <= now.getTime() ||
    (session.deleteAt !== null && session.deleteAt <= now)
  );
}

export type ActiveSession = {
  id: string;
  snapshotVersion: number;
  snapshotSeq: number;
  headSeq: number;
  expiresAt: Date;
  activeInstanceId: string | null;
  deleteAt: Date | null;
};

const ACTIVE_SELECT = {
  id: true,
  snapshotVersion: true,
  snapshotSeq: true,
  headSeq: true,
  expiresAt: true,
  lastSeenAt: true,
  deleteAt: true,
  activeInstanceId: true,
} as const;

/**
 * Sessão válida do cabeçalho X-Session-Id, ou undefined. A validade é conferida aqui, em toda
 * requisição, e não depende de o job de limpeza já ter rodado (L10). Atualiza o "último sinal".
 */
export async function findActiveSession(db: Db, req: Request): Promise<ActiveSession | undefined> {
  const token = readToken(req);
  return token ? findActiveSessionById(db, hashToken(token)) : undefined;
}

export async function findActiveSessionById(
  db: Db,
  id: string,
): Promise<ActiveSession | undefined> {
  const session = await db.session.findUnique({ where: { id }, select: ACTIVE_SELECT });
  if (!session || isExpired(session)) return undefined;
  await db.session.update({ where: { id }, data: { lastSeenAt: new Date() } });
  return {
    id: session.id,
    snapshotVersion: session.snapshotVersion,
    snapshotSeq: session.snapshotSeq,
    headSeq: session.headSeq,
    expiresAt: session.expiresAt,
    activeInstanceId: session.activeInstanceId,
    deleteAt: session.deleteAt,
  };
}

export async function requireSession(db: Db, req: Request): Promise<ActiveSession> {
  const session = await findActiveSession(db, req);
  if (!session) throw new ApiError(410, 'SESSION_EXPIRED', SESSION_EXPIRED_MESSAGE);
  return session;
}

export async function countActiveSessions(db: Db, ip: string): Promise<number> {
  const now = new Date();
  return db.session.count({
    where: {
      ipHash: ip,
      expiresAt: { gt: now },
      lastSeenAt: { gt: new Date(now.getTime() - SESSION_TIMING.inactivityMs) },
      // Sessões com exclusão agendada não contam (L15).
      deleteAt: null,
    },
  });
}

// ---------------------------------------------------------------------------------------------
// Ciclo de vida (docs/PLANO.md, seção 5)

/**
 * Retomar depois de F5, reabrir a aba ou voltar pelo bfcache: a instância nova assume a sessão
 * e a exclusão agendada pelo pagehide é cancelada.
 */
export async function resumeSession(db: Db, session: ActiveSession, instanceId: string) {
  await db.session.update({
    where: { id: session.id },
    data: { activeInstanceId: instanceId, deleteAt: null, lastSeenAt: new Date() },
  });
}

/**
 * Exclusão agendada pelo pagehide (fechar ou recarregar). Só vale para a instância ativa: se a
 * página nova já retomou a sessão, o beacon atrasado da antiga é ignorado (L11).
 */
export async function releaseSession(
  db: Db,
  token: string,
  instanceId: string,
  graceMs: number,
): Promise<Date | undefined> {
  const id = hashToken(token);
  const deleteAt = new Date(Date.now() + graceMs);
  const result = await db.session.updateMany({
    where: { id, activeInstanceId: instanceId, deleteAt: null },
    data: { deleteAt },
  });
  return result.count > 0 ? deleteAt : undefined;
}

/**
 * Confere que quem fala é a instância ativa. Sem instância registrada, a primeira assume.
 * Outra instância → 409 INSTANCE_REPLACED, e o navegador transforma a aba numa cópia.
 */
export async function assertActiveInstance(
  db: Db,
  session: ActiveSession,
  instanceId: string,
): Promise<void> {
  if (session.activeInstanceId === null) {
    await db.session.update({ where: { id: session.id }, data: { activeInstanceId: instanceId } });
    return;
  }
  if (session.activeInstanceId !== instanceId) {
    throw new ApiError(409, 'INSTANCE_REPLACED', INSTANCE_REPLACED_MESSAGE);
  }
}

/** Heartbeat da instância ativa: renova o sinal e desfaz uma exclusão agendada por engano. */
export async function heartbeat(db: Db, session: ActiveSession, instanceId: string) {
  await assertActiveInstance(db, session, instanceId);
  if (session.deleteAt !== null) {
    await db.session.update({ where: { id: session.id }, data: { deleteAt: null } });
  }
}

/**
 * Cópia independente da sessão ("Duplicar aba" ou instância substituída). Copia snapshot, log
 * e estado de exportação. Mantém o prazo máximo da original: duplicar não estende a vida dos dados.
 * SQL bruto: copiar os blocos com INSERT ... SELECT evita trazer os blobs para a memória.
 */
export async function forkSession(
  db: Db,
  sourceId: string,
  params: { ip: string; instanceId: string },
): Promise<{ token: string; id: string }> {
  const { token, id } = createSessionToken();
  const now = new Date();
  await db.$transaction(async (tx) => {
    const source = await tx.session.findUniqueOrThrow({ where: { id: sourceId } });
    await tx.session.create({
      data: {
        id,
        ipHash: params.ip,
        expiresAt: source.expiresAt,
        lastSeenAt: now,
        activeInstanceId: params.instanceId,
        headSeq: source.headSeq,
        snapshotVersion: source.snapshotVersion,
        snapshotSeq: source.snapshotSeq,
        sourceMeta: source.sourceMeta,
        exportState: source.exportState,
        bytesUsed: source.bytesUsed,
      },
    });
    await tx.$executeRaw`
      INSERT INTO "SnapshotManifest" ("sessionId", "version", "seq", "data")
      SELECT ${id}, "version", "seq", "data" FROM "SnapshotManifest" WHERE "sessionId" = ${sourceId}`;
    await tx.$executeRaw`
      INSERT INTO "SnapshotChunk" ("sessionId", "version", "tableId", "chunkIndex", "data")
      SELECT ${id}, "version", "tableId", "chunkIndex", "data"
      FROM "SnapshotChunk" WHERE "sessionId" = ${sourceId}`;
    await tx.$executeRaw`
      INSERT INTO "OpLog" ("sessionId", "seq", "opId", "payload", "createdAt")
      SELECT ${id}, "seq", "opId", "payload", "createdAt" FROM "OpLog" WHERE "sessionId" = ${sourceId}`;
  });
  return { token, id };
}
