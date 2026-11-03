import type {
  ChunkPayload,
  DocumentManifest,
  ImportOptions,
  ImportWarning,
  LogOp,
  PreviewTable,
} from '@datakit/core';
import { instanceId } from '../session/tabIdentity.ts';

// Cliente da API. O ID da sessão é credencial: vai só no cabeçalho, nunca na URL (seção 5.2).

const SESSION_KEY = 'dk.sid';

/** Cópia em memória: sem sessionStorage (modo restrito), a sessão vive só nesta página. */
let memoryToken: string | null = null;

export function getSessionToken(): string | null {
  try {
    return sessionStorage.getItem(SESSION_KEY) ?? memoryToken;
  } catch {
    return memoryToken;
  }
}

export function setSessionToken(token: string | null): void {
  memoryToken = token;
  try {
    if (token) sessionStorage.setItem(SESSION_KEY, token);
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Fica só a cópia em memória.
  }
}

/** Erro da API com mensagem em português pronta para mostrar. */
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

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = getSessionToken();
  if (token) headers.set('x-session-id', token);
  headers.set('x-instance-id', instanceId);
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers });
  } catch {
    throw new ApiError(
      0,
      'NETWORK',
      'Sem conexão com o servidor. Verifique a internet e tente de novo.',
    );
  }
  // 502/503/504 vêm do proxy quando a API está fora do ar (reinício, deploy): é o mesmo que
  // estar sem conexão, e quem chamou tenta de novo em vez de desistir.
  if (res.status === 502 || res.status === 503 || res.status === 504) {
    throw new ApiError(res.status, 'NETWORK', 'O servidor não está respondendo. Tentando de novo…');
  }
  if (!res.ok) {
    let code = 'HTTP_' + String(res.status);
    let message = 'Não foi possível concluir a operação. Tente novamente.';
    let details: Record<string, unknown> | undefined;
    try {
      const body = (await res.json()) as {
        error?: { code?: string; message?: string; details?: Record<string, unknown> };
      };
      if (body.error?.code) code = body.error.code;
      if (body.error?.message) message = body.error.message;
      details = body.error?.details;
    } catch {
      // Resposta sem JSON (ex.: proxy): fica a mensagem genérica.
    }
    throw new ApiError(res.status, code, message, details);
  }
  return res;
}

function base64UrlJson(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = '';
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export type ImportResponse = {
  sessionId?: string;
  version: number;
  warnings: ImportWarning[];
  tables: Array<{ id: string; name: string; rows: number; columns: number; hidden: boolean }>;
};

export async function uploadFile(file: File, options: ImportOptions): Promise<ImportResponse> {
  const res = await request('/api/import', {
    method: 'POST',
    headers: {
      'content-type': 'application/octet-stream',
      'x-file-name': encodeURIComponent(file.name),
      'x-import-options': base64UrlJson(options),
    },
    body: file,
  });
  return (await res.json()) as ImportResponse;
}

export type StageResponse = {
  stageId: string;
  preview: { withHeader: PreviewTable[]; withoutHeader: PreviewTable[] };
  warnings: { withHeader: ImportWarning[]; withoutHeader: ImportWarning[] };
};

export async function stageXlsx(file: File): Promise<StageResponse> {
  const res = await request('/api/import/stage', {
    method: 'POST',
    headers: {
      'content-type': 'application/octet-stream',
      'x-file-name': encodeURIComponent(file.name),
    },
    body: file,
  });
  return (await res.json()) as StageResponse;
}

export async function commitStaged(stageId: string, hasHeader: boolean): Promise<ImportResponse> {
  const res = await request('/api/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ stageId, options: { hasHeader } }),
  });
  return (await res.json()) as ImportResponse;
}

export async function fetchManifest(version: number): Promise<DocumentManifest> {
  const res = await request(`/api/session/manifest?v=${String(version)}`);
  return (await res.json()) as DocumentManifest;
}

export async function fetchChunk(
  tableId: string,
  index: number,
  version: number,
): Promise<ChunkPayload> {
  const res = await request(
    `/api/session/chunks/${encodeURIComponent(tableId)}/${String(index)}?v=${String(version)}`,
  );
  return (await res.json()) as ChunkPayload;
}

export async function fetchSessionState(): Promise<SessionState> {
  const res = await request('/api/session/state');
  return (await res.json()) as SessionState;
}

/** Operações do log depois do snapshot, para reaplicar (F5, aba reaberta ou duplicada). */
export async function fetchOpsAfter(after: number): Promise<LogOp[]> {
  const res = await request(`/api/session/ops?after=${String(after)}`);
  return (await res.json()) as LogOp[];
}

const COMPRESS_FROM_BYTES = 32 * 1024;

/** Envia operações. Corpos grandes (colagens) vão compactados com gzip. */
export async function postOps(ops: readonly LogOp[]): Promise<number> {
  const json = JSON.stringify({ instanceId, ops });
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  let body: BodyInit = json;
  if (json.length > COMPRESS_FROM_BYTES && 'CompressionStream' in window) {
    body = await new Response(
      new Blob([json]).stream().pipeThrough(new CompressionStream('gzip')),
    ).blob();
    headers['content-encoding'] = 'gzip';
  }
  const res = await request('/api/session/ops', { method: 'POST', headers, body });
  return ((await res.json()) as { ackedSeq: number }).ackedSeq;
}

export async function deleteSession(): Promise<void> {
  await request('/api/session', { method: 'DELETE' });
}

// --- Ciclo de vida da sessão (seção 5) --------------------------------------------------------

export type SessionState = {
  snapshotVersion: number;
  snapshotSeq: number;
  headSeq: number;
  expiresAt: string;
};

const jsonBody = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

export async function resumeSession(): Promise<SessionState> {
  const res = await request('/api/session/resume', jsonBody({ instanceId }));
  return (await res.json()) as SessionState;
}

export async function sendHeartbeat(): Promise<void> {
  await request('/api/session/heartbeat', jsonBody({ instanceId }));
}

/** Cópia independente da sessão atual; devolve o token novo. */
export async function forkSession(): Promise<string> {
  const res = await request('/api/session/fork', jsonBody({ instanceId }));
  return ((await res.json()) as { sessionId: string }).sessionId;
}

/** "Continuar em uma nova sessão" (L14): envia o documento da memória, já compactado. */
export async function restoreSession(gzipped: Blob): Promise<ImportResponse> {
  const res = await request('/api/session/restore', {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: gzipped,
  });
  return (await res.json()) as ImportResponse;
}

/**
 * pagehide: pede a exclusão agendada. O beacon não manda cabeçalhos, então o token vai no corpo,
 * como text/plain (sem preflight). Se o beacon não for aceito, tenta fetch com keepalive.
 */
export function sendRelease(pending: readonly LogOp[] = []): void {
  const token = getSessionToken();
  if (!token) return;
  // O beacon tem limite de ~64 KB: as operações só vão junto se couberem (a fila no
  // sessionStorage é a fonte principal; o servidor ignora repetições pelo opId).
  let body = JSON.stringify({ sid: token, instanceId, ops: pending });
  if (pending.length === 0 || body.length > 60 * 1024)
    body = JSON.stringify({ sid: token, instanceId });
  const blob = new Blob([body], { type: 'text/plain;charset=UTF-8' });
  if (navigator.sendBeacon('/api/session/release', blob)) return;
  void fetch('/api/session/release', {
    method: 'POST',
    headers: { 'content-type': 'text/plain;charset=UTF-8' },
    body,
    keepalive: true,
  }).catch(() => undefined);
}
