import type { Request } from 'express';
import type { LogOp } from '@datakit/core';
import type { Db } from '../persistence/prisma.ts';
import { log } from '../utils/log.ts';
import { isAdminRequest } from './adminSession.ts';
import { maskIp, normalizeIp, originHmac } from './ip.ts';

// Registro das métricas de uso (docs/PROMPT-METRICAS.md). Regras:
// - só metadados: formato, tamanho, ferramenta, resultado; nada de conteúdo, nomes ou linhas;
// - nunca atrasa nem quebra o editor: cada registro roda em segundo plano e uma falha só vai
//   para o log, sem conteúdo;
// - sem METRICS_HMAC_KEY, nada é registrado (é o caso do desenvolvimento e dos testes E2E).

export type MetricsConfig = {
  /** Chave do HMAC dos IPs. Sem ela, as métricas ficam desligadas. */
  hmacKey: string | undefined;
  retentionDays: number;
  /** Só em produção um acesso pode ser externo; fora dela tudo é "dev". */
  countExternal: boolean;
};

export type Classification = 'external' | 'admin' | 'dev';

export const DEDUP_WINDOW_MS = 10 * 60_000;

type Origin = { originHmac: string | null; maskedIp: string | null };

export type MetricsRecorder = {
  readonly enabled: boolean;
  /** Abertura do editor; deduplicada em 10 minutos por origem. */
  visit(req: Request): void;
  importFailed(req: Request, info: { format: string; sizeBytes: number; code: string }): void;
  /** Arquivo aberto numa sessão (nova ou substituindo o anterior). */
  importSucceeded(
    req: Request,
    info: { sessionHash: string; format: string; sizeBytes: number },
  ): void;
  /** "Duplicar aba": a cópia continua o mesmo arquivo, com a mesma classificação. */
  sessionCopied(fromHash: string, toHash: string): void;
  /** "Continuar em uma nova sessão" (L14): não é um arquivo novo, então não conta importação. */
  sessionRestored(req: Request, info: { sessionHash: string; format: string }): void;
  /** Operações gravadas no log (só as novas, não as repetidas). */
  opsAppended(req: Request, sessionHash: string, ops: readonly LogOp[]): void;
  /** Lote de operações recusado por ser inválido. */
  opsRejected(req: Request, sessionHash: string): void;
  exported(
    req: Request,
    info: { sessionHash: string; targetFormat: string; ok: boolean; code?: string },
  ): void;
  /** Espera os registros em andamento (testes e encerramento). */
  flush(): Promise<void>;
};

/** Formato pelo nome do arquivo ou extensão: "csv", "xlsx", "json" ou "outro". */
export function formatOf(fileNameOrExtension: string): string {
  const ext = /\.([a-z0-9]+)$/i.exec(fileNameOrExtension)?.[1]?.toLowerCase();
  return ext === 'csv' || ext === 'xlsx' || ext === 'json' ? ext : 'outro';
}

const disabled: MetricsRecorder = {
  enabled: false,
  visit: () => undefined,
  importFailed: () => undefined,
  importSucceeded: () => undefined,
  sessionCopied: () => undefined,
  sessionRestored: () => undefined,
  opsAppended: () => undefined,
  opsRejected: () => undefined,
  exported: () => undefined,
  flush: () => Promise.resolve(),
};

export function createMetricsRecorder(db: Db, config: MetricsConfig): MetricsRecorder {
  const key = config.hmacKey;
  if (!key) return disabled;

  const pending = new Set<Promise<void>>();
  const run = (what: string, task: () => Promise<void>): void => {
    const p = task()
      .catch((err: unknown) => {
        log.error('falha ao registrar métrica', {
          what,
          error: err instanceof Error ? err.name : 'erro',
        });
      })
      .finally(() => pending.delete(p));
    pending.add(p);
  };

  const origin = (req: Request): Origin => {
    const ip = normalizeIp(req.ip);
    return ip
      ? { originHmac: originHmac(ip, key), maskedIp: maskIp(ip) }
      : { originHmac: null, maskedIp: null };
  };

  const classify = async (req: Request): Promise<Classification> => {
    if (!config.countExternal) return 'dev';
    return (await isAdminRequest(db, req)) ? 'admin' : 'external';
  };

  /** Sessão nas métricas; se ela começou antes de as métricas existirem, é criada agora. */
  const sessionInfo = async (req: Request, sessionHash: string) => {
    const found = await db.metricsSession.findUnique({ where: { sessionHash } });
    if (found) return found;
    const session = await db.session.findUnique({
      where: { id: sessionHash },
      select: { sourceMeta: true },
    });
    let extension = '';
    try {
      const meta: unknown = JSON.parse(session?.sourceMeta ?? '{}');
      if (meta && typeof meta === 'object' && 'extension' in meta) {
        extension = typeof meta.extension === 'string' ? meta.extension : '';
      }
    } catch {
      extension = '';
    }
    return db.metricsSession.create({
      data: { sessionHash, classification: await classify(req), sourceFormat: formatOf(extension) },
    });
  };

  return {
    enabled: true,

    visit: (req) => {
      run('acesso', async () => {
        const where = origin(req);
        const classification = await classify(req);
        const now = Date.now();
        await db.$transaction(async (tx) => {
          if (where.originHmac) {
            // Uma instrução só: insere a origem nova ou atualiza a que passou da janela. Se
            // nada voltar, a origem já foi contada nos últimos 10 minutos. Concorrência: o
            // SQLite serializa as escritas, então duas requisições juntas não contam duas vezes.
            const counted = await tx.$queryRaw<{ originHmac: string }[]>`
              INSERT INTO "MetricsOriginLast" ("originHmac", "lastCountedAt")
              VALUES (${where.originHmac}, ${now})
              ON CONFLICT ("originHmac") DO UPDATE SET "lastCountedAt" = excluded."lastCountedAt"
              WHERE "MetricsOriginLast"."lastCountedAt" <= ${now - DEDUP_WINDOW_MS}
              RETURNING "originHmac"`;
            if (counted.length === 0) return;
          }
          await tx.metricsVisit.create({
            data: { at: new Date(now), ...where, classification },
          });
        });
      });
    },

    importFailed: (req, info) => {
      run('importação', async () => {
        await db.metricsImport.create({
          data: {
            ...origin(req),
            classification: await classify(req),
            format: info.format,
            sizeBytes: info.sizeBytes,
            ok: false,
            errorCode: info.code,
          },
        });
      });
    },

    importSucceeded: (req, info) => {
      run('importação', async () => {
        const existing = await db.metricsSession.findUnique({
          where: { sessionHash: info.sessionHash },
          select: { classification: true },
        });
        const classification = existing?.classification ?? (await classify(req));
        const row = await db.metricsImport.create({
          data: {
            ...origin(req),
            sessionHash: info.sessionHash,
            classification,
            format: info.format,
            sizeBytes: info.sizeBytes,
            ok: true,
          },
          select: { id: true },
        });
        await db.metricsSession.upsert({
          where: { sessionHash: info.sessionHash },
          create: {
            sessionHash: info.sessionHash,
            classification,
            importId: row.id,
            sourceFormat: info.format,
          },
          update: { importId: row.id, sourceFormat: info.format },
        });
      });
    },

    sessionCopied: (fromHash, toHash) => {
      run('cópia de sessão', async () => {
        const from = await db.metricsSession.findUnique({ where: { sessionHash: fromHash } });
        if (!from) return;
        await db.metricsSession.create({
          data: {
            sessionHash: toHash,
            classification: from.classification,
            importId: from.importId,
            sourceFormat: from.sourceFormat,
          },
        });
      });
    },

    sessionRestored: (req, info) => {
      run('sessão restaurada', async () => {
        await db.metricsSession.create({
          data: {
            sessionHash: info.sessionHash,
            classification: await classify(req),
            sourceFormat: info.format,
          },
        });
      });
    },

    opsAppended: (req, sessionHash, ops) => {
      const counted = ops.filter((op) => op.kind !== 'exported');
      if (counted.length === 0) return;
      run('edição', async () => {
        const session = await sessionInfo(req, sessionHash);
        const where = origin(req);
        await db.metricsEdit.createMany({
          data: counted.map((op) => ({
            ...where,
            importId: session.importId,
            sessionHash,
            classification: session.classification,
            sourceFormat: session.sourceFormat,
            kind: op.kind,
            tool: op.kind === 'edit' ? (op.tool ?? null) : null,
            ok: true,
          })),
        });
      });
    },

    opsRejected: (req, sessionHash) => {
      run('edição', async () => {
        const session = await sessionInfo(req, sessionHash);
        await db.metricsEdit.create({
          data: {
            ...origin(req),
            importId: session.importId,
            sessionHash,
            classification: session.classification,
            sourceFormat: session.sourceFormat,
            kind: 'edit',
            ok: false,
          },
        });
      });
    },

    exported: (req, info) => {
      run('exportação', async () => {
        const session = await sessionInfo(req, info.sessionHash);
        await db.metricsExport.create({
          data: {
            ...origin(req),
            importId: session.importId,
            sessionHash: info.sessionHash,
            classification: session.classification,
            sourceFormat: session.sourceFormat,
            targetFormat: info.targetFormat,
            ok: info.ok,
            errorCode: info.code ?? null,
          },
        });
      });
    },

    flush: async () => {
      while (pending.size > 0) await Promise.all([...pending]);
    },
  };
}
