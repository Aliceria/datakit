// Cliente das rotas do painel (/api/metrics/admin/*). O login fica num cookie HttpOnly que o
// navegador manda sozinho; nenhum segredo passa pelo código da página.

export type Period = '24h' | '7d' | '30d' | 'all';
export type View = 'community' | 'admin';
export type Count = { key: string; count: number };

export type Summary = {
  period: Period;
  view: View;
  since: string | null;
  cards: {
    visitsTotal: number;
    visitsExternal: number;
    visitsAdmin: number;
    distinctOrigins: number;
    distinctOriginsIsDailySum: boolean;
    filesImported: number;
    filesEdited: number;
    filesExported: number;
    completeSessions: number;
    operations: number;
  };
  charts: {
    visitsPerDay: { day: string; external: number; admin: number }[];
    importFormats: Count[];
    exportFormats: Count[];
    conversions: Count[];
    tools: Count[];
    cumulative: { day: string; visits: number; imports: number; exports: number }[];
  };
};

export type Me = { retentionDays: number; recording: boolean };

export type Page<T> = { rows: T[]; total: number; page: number; pageSize: number };
export type VisitRow = { at: string; maskedIp: string | null; classification: string };
export type EventRow = {
  at: string;
  type: 'import' | 'edit' | 'export';
  maskedIp: string | null;
  classification: string;
  operation: string | null;
  sourceFormat: string;
  targetFormat: string | null;
  ok: boolean;
  errorCode: string | null;
};

export class PanelError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/metrics/admin/${path}`, { ...init, credentials: 'same-origin' });
  } catch {
    throw new PanelError(0, 'Sem conexão com o servidor.');
  }
  if (!res.ok) {
    let message = 'Não foi possível carregar.';
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      message = body.error?.message ?? message;
    } catch {
      // Corpo sem JSON: fica a mensagem padrão.
    }
    throw new PanelError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const query = (params: Record<string, string | number | undefined>) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : '';
};

export const panelApi = {
  me: () => call<Me>('me'),
  login: (user: string, password: string) =>
    call<undefined>('login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ user, password }),
    }),
  logout: () => call<undefined>('logout', { method: 'POST' }),
  summary: (period: Period, view: View) => call<Summary>(`summary${query({ period, view })}`),
  visits: (page: number, classification?: string) =>
    call<Page<VisitRow>>(`visits${query({ page, classification })}`),
  events: (filters: {
    page: number;
    type?: string | undefined;
    format?: string | undefined;
    ok?: string | undefined;
    classification?: string | undefined;
  }) => call<Page<EventRow>>(`events${query(filters)}`),
  reportUrl: (period: Period, view: View, format: 'csv' | 'json') =>
    `/api/metrics/admin/report${query({ period, view, format })}`,
};
