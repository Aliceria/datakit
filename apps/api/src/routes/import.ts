import express, { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  ImportError,
  LIMITS,
  assertFileSize,
  fileExtension,
  formatFromFileName,
  type ImportOptions,
  type SourceInfo,
} from '@datakit/core';
import type { BusinessLimits } from '../config/env.ts';
import type { Db } from '../persistence/prisma.ts';
import {
  assertCanCreateSession,
  assertStorageAvailable,
  putStaged,
  registerImport,
  saveDocument,
  takeStaged,
} from '../services/importService.ts';
import { findActiveSession, ipHash, logId } from '../services/sessionService.ts';
import { ApiError } from '../utils/httpErrors.ts';
import { log } from '../utils/log.ts';
import { parseInWorker } from '../workers/pool.ts';
import type { EncodedDocument } from '../workers/parseJob.ts';

const optionsSchema = z
  .object({
    hasHeader: z.boolean().optional(),
    encoding: z.enum(['utf-8', 'utf-8-bom', 'windows-1252']).optional(),
    delimiter: z.enum([',', ';', '\t', '|']).optional(),
    jsonRootPath: z.array(z.string().max(1000)).max(32).optional(),
  })
  .strict();

const commitSchema = z
  .object({
    stageId: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
    options: z.object({ hasHeader: z.boolean() }).strict(),
  })
  .strict();

const FILE_NAME_MAX = 255;

/** Nome do arquivo vem em X-File-Name, codificado com encodeURIComponent. */
function readFileName(req: Request): string {
  const header = req.header('x-file-name');
  let name: string | undefined;
  try {
    name = header === undefined ? undefined : decodeURIComponent(header);
  } catch {
    name = undefined;
  }
  // Só o nome, sem caminho e sem caracteres de controle.
  const clean = name
    ?.split(/[\\/]/)
    .pop()
    ?.split('')
    .filter((ch) => ch.charCodeAt(0) >= 0x20 && ch.charCodeAt(0) !== 0x7f)
    .join('')
    .trim();
  if (!clean || clean.length > FILE_NAME_MAX) {
    throw new ApiError(400, 'BAD_FILE_NAME', 'Nome de arquivo ausente ou inválido.');
  }
  return clean;
}

function readOptions(req: Request): ImportOptions {
  const header = req.header('x-import-options');
  if (!header) return {};
  try {
    const json: unknown = JSON.parse(Buffer.from(header, 'base64url').toString('utf8'));
    const parsed = optionsSchema.parse(json);
    const options: ImportOptions = {};
    if (parsed.hasHeader !== undefined) options.hasHeader = parsed.hasHeader;
    if (parsed.encoding) options.encoding = parsed.encoding;
    if (parsed.delimiter) options.delimiter = parsed.delimiter;
    if (parsed.jsonRootPath) options.jsonRootPath = parsed.jsonRootPath;
    return options;
  } catch {
    throw new ApiError(400, 'BAD_OPTIONS', 'Opções de importação inválidas.');
  }
}

function asApiError(err: ImportError | { code: string; message: string }): ApiError {
  const status =
    err.code === 'UNSUPPORTED_FORMAT'
      ? 415
      : err.code === 'FILE_TOO_LARGE'
        ? 413
        : err.code === 'INTERNAL' || err.code === 'TIMEOUT'
          ? 500
          : 422;
  return new ApiError(status, err.code, err.message);
}

/** Passos 1 e 2 da validação (seção 6.1): extensão e tamanho, antes de ler o corpo. */
function validateNameAndSize(req: Request): string {
  const fileName = readFileName(req);
  try {
    formatFromFileName(fileName);
    const declared = Number(req.header('content-length') ?? '0');
    assertFileSize(declared);
  } catch (err) {
    if (err instanceof ImportError) throw asApiError(err);
    throw err;
  }
  return fileName;
}

const rawBody = express.raw({ type: 'application/octet-stream', limit: LIMITS.maxFileBytes });

/** Cópia do corpo num ArrayBuffer próprio, que é transferido ao worker e some daqui. */
function bodyBytes(req: Request): Uint8Array {
  const body: unknown = req.body;
  if (!(body instanceof Buffer)) {
    throw new ApiError(400, 'BAD_BODY', 'Envie o arquivo como application/octet-stream.');
  }
  return new Uint8Array(body);
}

function sourceMeta(fileName: string, summary: EncodedDocument['summary']): string {
  const meta: Pick<SourceInfo, 'fileName' | 'extension' | 'sizeBytes'> = {
    fileName,
    extension: fileExtension(fileName),
    sizeBytes: summary.sizeBytes,
  };
  return JSON.stringify(meta);
}

async function finishImport(
  db: Db,
  limits: BusinessLimits,
  req: Request,
  res: Response,
  fileName: string,
  document: EncodedDocument,
): Promise<void> {
  const ip = ipHash(req);
  const existing = await findActiveSession(db, req);
  if (!existing) await assertCanCreateSession(db, ip, limits.activeSessionsPerIp);
  const saved = await saveDocument(db, {
    ...(existing ? { sessionId: existing.id } : {}),
    ip,
    document,
    sourceMeta: sourceMeta(fileName, document.summary),
  });
  log.info('importação concluída', {
    session: logId(saved.sessionId),
    format: fileExtension(fileName),
    bytes: document.summary.sizeBytes,
    replaced: existing !== undefined,
  });
  res.status(existing ? 200 : 201).json({
    ...(saved.token ? { sessionId: saved.token } : {}),
    version: saved.version,
    warnings: document.summary.warnings,
    tables: document.summary.tables,
  });
}

export function importRouter(db: Db, limits: BusinessLimits): Router {
  const router = Router();

  // CSV e JSON (e XLSX direto, sem pré-visualização): corpo binário.
  // Confirmação de um XLSX em espera: corpo JSON com o stageId.
  router.post('/import', async (req, res, next) => {
    try {
      if (req.is('application/json')) {
        const parsed = commitSchema.safeParse(req.body);
        if (!parsed.success) throw new ApiError(400, 'BAD_REQUEST', 'Requisição inválida.');
        const entry = takeStaged(parsed.data.stageId, ipHash(req));
        const document = parsed.data.options.hasHeader
          ? entry.variants.withHeader
          : entry.variants.withoutHeader;
        await finishImport(db, limits, req, res, entry.fileName, document);
        return;
      }

      const fileName = validateNameAndSize(req);
      const options = readOptions(req);
      await assertStorageAvailable(db);
      await new Promise<void>((resolve, reject) => {
        rawBody(req, res, (err?: unknown) => {
          if (err)
            reject(err instanceof Error ? err : new Error('Falha ao ler o arquivo enviado.'));
          else resolve();
        });
      });
      const bytes = bodyBytes(req);
      await registerImport(db, ipHash(req), limits.importsPerHour);
      const result = await parseInWorker({ kind: 'import', bytes, fileName, options });
      if (!result.ok) throw asApiError(result.error);
      if (result.kind !== 'import') throw new Error('Resposta inesperada do worker');
      await finishImport(db, limits, req, res, fileName, result.document);
    } catch (err) {
      next(err);
    }
  });

  // XLSX: processa e devolve a pré-visualização (feita no servidor — L3).
  router.post('/import/stage', async (req, res, next) => {
    try {
      const fileName = validateNameAndSize(req);
      if (fileExtension(fileName) !== '.xlsx') {
        throw new ApiError(400, 'BAD_REQUEST', 'A pré-visualização no servidor é só para XLSX.');
      }
      await assertStorageAvailable(db);
      await new Promise<void>((resolve, reject) => {
        rawBody(req, res, (err?: unknown) => {
          if (err)
            reject(err instanceof Error ? err : new Error('Falha ao ler o arquivo enviado.'));
          else resolve();
        });
      });
      const bytes = bodyBytes(req);
      const ip = ipHash(req);
      await registerImport(db, ip, limits.importsPerHour);
      const result = await parseInWorker({ kind: 'stage', bytes, fileName });
      if (!result.ok) throw asApiError(result.error);
      if (result.kind !== 'stage') throw new Error('Resposta inesperada do worker');
      const stageId = putStaged({ ip, fileName, variants: result.staged });
      res.json({
        stageId,
        preview: result.staged.preview,
        warnings: {
          withHeader: result.staged.withHeader.summary.warnings,
          withoutHeader: result.staged.withoutHeader.summary.warnings,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
