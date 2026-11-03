import type {
  ChunkPayload,
  DocumentManifest,
  ImportOptions,
  ImportWarning,
  PreviewTable,
} from '@datakit/core';

// Cliente da API. O ID da sessão é credencial: vai só no cabeçalho, nunca na URL (seção 5.2).

const SESSION_KEY = 'dk.sid';

export function getSessionToken(): string | null {
  try {
    return sessionStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

export function setSessionToken(token: string | null): void {
  try {
    if (token) sessionStorage.setItem(SESSION_KEY, token);
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Sem sessionStorage (modo restrito do navegador): a sessão vive só na memória desta página.
  }
}

/** Erro da API com mensagem em português pronta para mostrar. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = getSessionToken();
  if (token) headers.set('x-session-id', token);
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
  if (!res.ok) {
    let code = 'HTTP_' + String(res.status);
    let message = 'Não foi possível concluir a operação. Tente novamente.';
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } };
      if (body.error?.code) code = body.error.code;
      if (body.error?.message) message = body.error.message;
    } catch {
      // Resposta sem JSON (ex.: proxy): fica a mensagem genérica.
    }
    throw new ApiError(res.status, code, message);
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

export async function fetchManifest(): Promise<DocumentManifest> {
  const res = await request('/api/session/manifest');
  return (await res.json()) as DocumentManifest;
}

export async function fetchChunk(tableId: string, index: number): Promise<ChunkPayload> {
  const res = await request(`/api/session/chunks/${encodeURIComponent(tableId)}/${String(index)}`);
  return (await res.json()) as ChunkPayload;
}

export async function deleteSession(): Promise<void> {
  await request('/api/session', { method: 'DELETE' });
}
