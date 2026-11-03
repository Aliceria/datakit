import crypto from 'node:crypto';
import type { Request } from 'express';
import { SESSION_TIMING } from '@datakit/core';
import type { Db } from '../persistence/prisma.ts';
import { ApiError } from '../utils/httpErrors.ts';

export const SESSION_HEADER = 'x-session-id';
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

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

export function readToken(req: Request): string | undefined {
  const value = req.header(SESSION_HEADER);
  return value && TOKEN_PATTERN.test(value) ? value : undefined;
}

export function isExpired(
  session: { expiresAt: Date; lastSeenAt: Date; deleteAt: Date | null },
  now = new Date(),
): boolean {
  return (
    session.expiresAt <= now ||
    session.lastSeenAt.getTime() + SESSION_TIMING.inactivityMs <= now.getTime() ||
    (session.deleteAt !== null && session.deleteAt <= now)
  );
}

export type ActiveSession = {
  id: string;
  snapshotVersion: number;
};

/**
 * Sessão válida do cabeçalho X-Session-Id, ou undefined. A validade é conferida aqui, em toda
 * requisição, e não depende de o job de limpeza já ter rodado (L10). Atualiza o "último sinal".
 */
export async function findActiveSession(db: Db, req: Request): Promise<ActiveSession | undefined> {
  const token = readToken(req);
  if (!token) return undefined;
  const id = hashToken(token);
  const session = await db.session.findUnique({
    where: { id },
    select: { id: true, snapshotVersion: true, expiresAt: true, lastSeenAt: true, deleteAt: true },
  });
  if (!session || isExpired(session)) return undefined;
  await db.session.update({ where: { id }, data: { lastSeenAt: new Date() } });
  return { id: session.id, snapshotVersion: session.snapshotVersion };
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
