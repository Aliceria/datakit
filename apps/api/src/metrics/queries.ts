import type { Db } from '../persistence/prisma.ts';
import { saoPauloDay, saoPauloDayStart } from './retention.ts';

// Consultas do painel /metrics. Todos os números vêm dos registros do banco, sem estimativa.

export const PERIODS = ['24h', '7d', '30d', 'all'] as const;
export type Period = (typeof PERIODS)[number];
/** "community" = só acessos externos; "admin" = só os do administrador. */
export type View = 'community' | 'admin';

const PERIOD_MS: Record<Exclude<Period, 'all'>, number> = {
  '24h': 86_400_000,
  '7d': 7 * 86_400_000,
  '30d': 30 * 86_400_000,
};

export function periodStart(period: Period, now = new Date()): Date | undefined {
  return period === 'all' ? undefined : new Date(now.getTime() - PERIOD_MS[period]);
}

const classOf = (view: View) => (view === 'community' ? 'external' : 'admin');

type Count = { key: string; count: number };

const sortCounts = (m: Map<string, number>): Count[] =>
  [...m.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));

export type Summary = {
  period: Period;
  view: View;
  /** Primeiro registro de qualquer tipo (o painel mostra "registrando desde"). */
  since: string | null;
  cards: {
    visitsTotal: number;
    visitsExternal: number;
    visitsAdmin: number;
    distinctOrigins: number;
    /** Em "todo o período", as origens são somadas dia a dia (os HMACs somem em 30 dias). */
    distinctOriginsIsDailySum: boolean;
    filesImported: number;
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

export async function summary(
  db: Db,
  period: Period,
  view: View,
  now = new Date(),
): Promise<Summary> {
  const start = periodStart(period, now);
  const at = start ? { at: { gte: start } } : {};
  const classification = classOf(view);

  const [visits, imports, edits, exports, first] = await Promise.all([
    db.metricsVisit.findMany({
      where: { ...at, classification: { in: ['external', 'admin'] } },
      select: { at: true, classification: true, originHmac: true },
    }),
    db.metricsImport.findMany({
      where: { ...at, classification, ok: true },
      select: { id: true, at: true, format: true },
    }),
    db.metricsEdit.findMany({
      where: { ...at, classification, ok: true },
      select: { kind: true, tool: true },
    }),
    db.metricsExport.findMany({
      where: { ...at, classification, ok: true },
      select: { at: true, importId: true, sourceFormat: true, targetFormat: true },
    }),
    Promise.all([
      db.metricsVisit.findFirst({ orderBy: { at: 'asc' }, select: { at: true } }),
      db.metricsImport.findFirst({ orderBy: { at: 'asc' }, select: { at: true } }),
    ]),
  ]);

  const viewVisits = visits.filter((v) => v.classification === classification);

  // Origens distintas: com os HMACs (até 30 dias) ou somadas dia a dia em "todo o período".
  let distinctOrigins: number;
  const dailySum = period === 'all';
  if (dailySum) {
    const today = saoPauloDay(now);
    const stored = await db.metricsDaily.findMany({
      where: { classification, day: { lt: today } },
      select: { day: true, distinctOrigins: true },
    });
    const storedDays = new Set(stored.map((d) => d.day));
    let sum = stored.reduce((n, d) => n + d.distinctOrigins, 0);
    // Dias ainda não resumidos (hoje e, entre duas limpezas, ontem): calcula com os HMACs.
    const live = new Map<string, Set<string>>();
    for (const v of viewVisits) {
      const day = saoPauloDay(v.at);
      if (storedDays.has(day) || !v.originHmac) continue;
      const set = live.get(day) ?? new Set<string>();
      set.add(v.originHmac);
      live.set(day, set);
    }
    for (const set of live.values()) sum += set.size;
    distinctOrigins = sum;
  } else {
    distinctOrigins = new Set(viewVisits.flatMap((v) => (v.originHmac ? [v.originHmac] : []))).size;
  }

  const importIds = new Set(imports.map((i) => i.id));
  const exportedIds = new Set(exports.flatMap((e) => (e.importId === null ? [] : [e.importId])));
  const completeSessions = [...importIds].filter((id) => exportedIds.has(id)).length;

  const count = <T>(rows: readonly T[], key: (r: T) => string | undefined) => {
    const m = new Map<string, number>();
    for (const r of rows) {
      const k = key(r);
      if (k !== undefined) m.set(k, (m.get(k) ?? 0) + 1);
    }
    return sortCounts(m);
  };

  // Acessos por dia (externos e administrativos) e evolução acumulada da visão escolhida.
  const perDay = new Map<string, { external: number; admin: number }>();
  for (const v of visits) {
    const day = saoPauloDay(v.at);
    const entry = perDay.get(day) ?? { external: 0, admin: 0 };
    if (v.classification === 'external') entry.external += 1;
    else entry.admin += 1;
    perDay.set(day, entry);
  }
  const days = new Set<string>([...perDay.keys()]);
  const importsPerDay = new Map<string, number>();
  for (const i of imports) {
    const d = saoPauloDay(i.at);
    days.add(d);
    importsPerDay.set(d, (importsPerDay.get(d) ?? 0) + 1);
  }
  const exportsPerDay = new Map<string, number>();
  for (const e of exports) {
    const d = saoPauloDay(e.at);
    days.add(d);
    exportsPerDay.set(d, (exportsPerDay.get(d) ?? 0) + 1);
  }
  const orderedDays = fillDays([...days].sort(), start ? saoPauloDay(start) : undefined, now);
  let cv = 0;
  let ci = 0;
  let ce = 0;
  const cumulative = orderedDays.map((day) => {
    const visitsToday = perDay.get(day);
    cv += visitsToday ? visitsToday[view === 'community' ? 'external' : 'admin'] : 0;
    ci += importsPerDay.get(day) ?? 0;
    ce += exportsPerDay.get(day) ?? 0;
    return { day, visits: cv, imports: ci, exports: ce };
  });

  const firstAt = [first[0]?.at, first[1]?.at]
    .filter((d): d is Date => d !== undefined)
    .sort((a, b) => a.getTime() - b.getTime())[0];

  return {
    period,
    view,
    since: firstAt ? firstAt.toISOString() : null,
    cards: {
      visitsTotal: visits.length,
      visitsExternal: visits.filter((v) => v.classification === 'external').length,
      visitsAdmin: visits.filter((v) => v.classification === 'admin').length,
      distinctOrigins,
      distinctOriginsIsDailySum: dailySum,
      filesImported: imports.length,
      filesExported: [...exportedIds].filter((id) => importIds.has(id)).length,
      completeSessions,
      operations: edits.length,
    },
    charts: {
      visitsPerDay: orderedDays.map((day) => ({
        day,
        external: perDay.get(day)?.external ?? 0,
        admin: perDay.get(day)?.admin ?? 0,
      })),
      importFormats: count(imports, (i) => i.format),
      exportFormats: count(exports, (e) => e.targetFormat),
      conversions: count(exports, (e) => `${e.sourceFormat}→${e.targetFormat}`),
      tools: count(edits, (e) => (e.kind === 'edit' ? (e.tool ?? 'edicao') : e.kind)),
      cumulative,
    },
  };
}

/** Todos os dias entre o primeiro (ou o início do período) e hoje, para o gráfico não ter buracos. */
function fillDays(days: string[], from: string | undefined, now: Date): string[] {
  const first = from ?? days[0];
  if (!first) return [];
  const out: string[] = [];
  const last = saoPauloDay(now);
  for (let t = saoPauloDayStart(first).getTime(); ; t += 86_400_000) {
    const day = saoPauloDay(new Date(t));
    out.push(day);
    if (day >= last || out.length > 5000) break;
  }
  return out;
}

// --- Históricos ---------------------------------------------------------------------------------

export const PAGE_SIZE = 50;

export type VisitRow = { at: string; maskedIp: string | null; classification: string };

export async function visitHistory(
  db: Db,
  params: { page: number; classification?: string | undefined; retentionDays: number },
  now = new Date(),
): Promise<{ rows: VisitRow[]; total: number; page: number; pageSize: number }> {
  const where = {
    at: { gte: new Date(now.getTime() - params.retentionDays * 86_400_000) },
    ...(params.classification ? { classification: params.classification } : {}),
  };
  const [total, rows] = await Promise.all([
    db.metricsVisit.count({ where }),
    db.metricsVisit.findMany({
      where,
      orderBy: [{ at: 'desc' }, { id: 'desc' }],
      skip: (params.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: { at: true, maskedIp: true, classification: true },
    }),
  ]);
  return {
    rows: rows.map((r) => ({ ...r, at: r.at.toISOString() })),
    total,
    page: params.page,
    pageSize: PAGE_SIZE,
  };
}

export const EVENT_TYPES = ['import', 'edit', 'export'] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export type EventRow = {
  at: string;
  type: EventType;
  maskedIp: string | null;
  classification: string;
  /** Ferramenta da edição, "undo" ou "redo"; vazio em importação e exportação. */
  operation: string | null;
  sourceFormat: string;
  targetFormat: string | null;
  ok: boolean;
  errorCode: string | null;
};

export type EventFilters = {
  page: number;
  type?: EventType | undefined;
  classification?: string | undefined;
  format?: string | undefined;
  ok?: boolean | undefined;
  retentionDays: number;
};

/** Importações, edições e exportações juntas, da mais recente para a mais antiga. */
export async function eventHistory(
  db: Db,
  f: EventFilters,
  now = new Date(),
): Promise<{ rows: EventRow[]; total: number; page: number; pageSize: number }> {
  const base = {
    at: { gte: new Date(now.getTime() - f.retentionDays * 86_400_000) },
    ...(f.classification ? { classification: f.classification } : {}),
    ...(f.ok !== undefined ? { ok: f.ok } : {}),
  };
  const take = f.page * PAGE_SIZE;
  const want = (t: EventType) => f.type === undefined || f.type === t;
  const fmt = f.format;

  const importWhere = { ...base, ...(fmt ? { format: fmt } : {}) };
  const editWhere = { ...base, ...(fmt ? { sourceFormat: fmt } : {}) };
  const exportWhere = {
    ...base,
    ...(fmt ? { OR: [{ sourceFormat: fmt }, { targetFormat: fmt }] } : {}),
  };
  const order = [{ at: 'desc' as const }, { id: 'desc' as const }];

  const [imports, edits, exports, counts] = await Promise.all([
    want('import')
      ? db.metricsImport.findMany({ where: importWhere, orderBy: order, take })
      : Promise.resolve([]),
    want('edit')
      ? db.metricsEdit.findMany({ where: editWhere, orderBy: order, take })
      : Promise.resolve([]),
    want('export')
      ? db.metricsExport.findMany({ where: exportWhere, orderBy: order, take })
      : Promise.resolve([]),
    Promise.all([
      want('import') ? db.metricsImport.count({ where: importWhere }) : 0,
      want('edit') ? db.metricsEdit.count({ where: editWhere }) : 0,
      want('export') ? db.metricsExport.count({ where: exportWhere }) : 0,
    ]),
  ]);

  const rows: EventRow[] = [
    ...imports.map((r) => ({
      at: r.at.toISOString(),
      type: 'import' as const,
      maskedIp: r.maskedIp,
      classification: r.classification,
      operation: null,
      sourceFormat: r.format,
      targetFormat: null,
      ok: r.ok,
      errorCode: r.errorCode,
    })),
    ...edits.map((r) => ({
      at: r.at.toISOString(),
      type: 'edit' as const,
      maskedIp: r.maskedIp,
      classification: r.classification,
      operation: r.kind === 'edit' ? (r.tool ?? 'edicao') : r.kind,
      sourceFormat: r.sourceFormat,
      targetFormat: null,
      ok: r.ok,
      errorCode: null,
    })),
    ...exports.map((r) => ({
      at: r.at.toISOString(),
      type: 'export' as const,
      maskedIp: r.maskedIp,
      classification: r.classification,
      operation: null,
      sourceFormat: r.sourceFormat,
      targetFormat: r.targetFormat,
      ok: r.ok,
      errorCode: r.errorCode,
    })),
  ].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

  return {
    rows: rows.slice((f.page - 1) * PAGE_SIZE, f.page * PAGE_SIZE),
    total: counts.reduce((n, c) => n + c, 0),
    page: f.page,
    pageSize: PAGE_SIZE,
  };
}

// --- Relatório ----------------------------------------------------------------------------------

/** Totais do período em CSV (indicador;valor), para a apresentação. */
export function reportCsv(s: Summary): string {
  const lines: [string, string | number][] = [
    ['periodo', s.period],
    ['visao', s.view === 'community' ? 'comunidade' : 'administrador'],
    ['registrando_desde', s.since ?? ''],
    ['acessos_total', s.cards.visitsTotal],
    ['acessos_externos', s.cards.visitsExternal],
    ['acessos_administrativos', s.cards.visitsAdmin],
    [
      s.cards.distinctOriginsIsDailySum ? 'origens_distintas_soma_por_dia' : 'origens_distintas',
      s.cards.distinctOrigins,
    ],
    ['arquivos_importados', s.cards.filesImported],
    ['arquivos_exportados', s.cards.filesExported],
    ['sessoes_completas', s.cards.completeSessions],
    ['operacoes', s.cards.operations],
    ...s.charts.importFormats.map((c): [string, number] => [`importados_${c.key}`, c.count]),
    ...s.charts.exportFormats.map((c): [string, number] => [`exportados_${c.key}`, c.count]),
    ...s.charts.conversions.map((c): [string, number] => [`conversao_${c.key}`, c.count]),
    ...s.charts.tools.map((c): [string, number] => [`ferramenta_${c.key}`, c.count]),
  ];
  return `indicador;valor\r\n${lines.map(([k, v]) => `${k};${String(v)}`).join('\r\n')}\r\n`;
}
