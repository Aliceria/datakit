import crypto from 'node:crypto';
import type { Request } from 'express';
import type { Db } from '../persistence/prisma.ts';

// Sessão de login do painel /metrics. O cookie leva um token aleatório; o banco guarda só o
// SHA-256 dele. O login em si (usuário e senha do .env) é a etapa M2; aqui fica a verificação,
// usada também para classificar os acessos do administrador.

export const ADMIN_COOKIE = 'dk_admin';

/** Lê um cookie do cabeçalho, sem dependência nova. */
export function readCookie(req: Request, name: string): string | undefined {
  const header = req.header('cookie');
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    const value = part.slice(eq + 1).trim();
    return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : undefined;
  }
  return undefined;
}

export const hashAdminToken = (token: string): string =>
  crypto.createHash('sha256').update(`datakit-admin:${token}`).digest('hex');

/** O navegador está logado no painel, com uma sessão ainda válida? */
export async function isAdminRequest(db: Db, req: Request, now = new Date()): Promise<boolean> {
  const token = readCookie(req, ADMIN_COOKIE);
  if (!token) return false;
  const row = await db.metricsAdminSession.findUnique({
    where: { tokenHash: hashAdminToken(token) },
    select: { expiresAt: true },
  });
  return row !== null && row.expiresAt > now;
}
