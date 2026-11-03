import type { ErrorRequestHandler, RequestHandler } from 'express';
import { log } from './log.ts';

/** Erro de API com código estável e mensagem em português, mostrada ao usuário. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown> | undefined;

  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export type ErrorBody = {
  error: { code: string; message: string; details?: Record<string, unknown> };
};

export const apiNotFound: RequestHandler = (_req, _res, next) => {
  next(new ApiError(404, 'NOT_FOUND', 'Endereço da API não encontrado.'));
};

/** Último middleware: nunca devolve stack trace (seção 6.1). */
export const errorHandler: ErrorRequestHandler = (err: unknown, _req, res, _next) => {
  if (err instanceof ApiError) {
    const body: ErrorBody = { error: { code: err.code, message: err.message } };
    if (err.details) body.error.details = err.details;
    res.status(err.status).json(body);
    return;
  }

  // Erros do body-parser (JSON malformado, corpo grande demais) trazem status próprio.
  const status = readStatus(err);
  if (status === 413) {
    res.status(413).json({
      error: { code: 'PAYLOAD_TOO_LARGE', message: 'O conteúdo enviado é grande demais.' },
    } satisfies ErrorBody);
    return;
  }
  if (status === 400) {
    res.status(400).json({
      error: { code: 'BAD_REQUEST', message: 'Requisição inválida.' },
    } satisfies ErrorBody);
    return;
  }

  log.error('erro não tratado', { error: err instanceof Error ? err.message : String(err) });
  res.status(500).json({
    error: { code: 'INTERNAL', message: 'Erro interno. Tente novamente em instantes.' },
  } satisfies ErrorBody);
};

function readStatus(err: unknown): number | undefined {
  if (typeof err === 'object' && err !== null && 'status' in err) {
    const { status } = err;
    return typeof status === 'number' ? status : undefined;
  }
  return undefined;
}
