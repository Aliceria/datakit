import crypto from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LogOp } from '@datakit/core';
import { purgeMetrics } from '../metrics/retention.ts';
import type { Summary } from '../metrics/queries.ts';
import { startTestServer, type TestServer, type TestServerOptions } from '../test/server.ts';
import { LOGIN_ATTEMPTS } from './metricsAdmin.ts';

// Painel de métricas, etapa M2: login com usuário e senha do .env e consultas dos números.

const KEY = 'chave-de-teste-com-mais-de-32-caracteres';
const USER = 'professor';
const PASSWORD = 'senha-do-painel-123';
let server: TestServer;
afterEach(async () => {
  vi.useRealTimers();
  await server.close();
});

async function start(options: TestServerOptions = {}) {
  server = await startTestServer({
    trustProxy: 1,
    metrics: { hmacKey: KEY, countExternal: true, adminUser: USER, adminPassword: PASSWORD },
    ...options,
  });
  return server;
}

const api = (path: string, init: RequestInit = {}) => fetch(`${server.baseUrl}/api${path}`, init);

function login(user = USER, password = PASSWORD, ip = '192.0.2.50') {
  return api('/metrics/admin/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ user, password }),
  });
}

async function cookie(): Promise<string> {
  const res = await login();
  expect(res.status).toBe(204);
  const set = res.headers.get('set-cookie') ?? '';
  return set.split(';')[0] ?? '';
}

const get = (path: string, c?: string) => api(path, c ? { headers: { cookie: c } } : {});

function visit(ip: string, c?: string) {
  return api('/metrics/visit', {
    method: 'POST',
    headers: { 'x-forwarded-for': ip, ...(c ? { cookie: c } : {}) },
  });
}

async function openFile(ip: string, name: string, body: string, c?: string) {
  const instanceId = crypto.randomUUID();
  const res = await api('/import', {
    method: 'POST',
    headers: {
      'content-type': 'application/octet-stream',
      'x-file-name': encodeURIComponent(name),
      'x-instance-id': instanceId,
      'x-forwarded-for': ip,
      ...(c ? { cookie: c } : {}),
    },
    body: new TextEncoder().encode(body),
  });
  expect(res.status).toBe(201);
  const { sessionId } = (await res.json()) as { sessionId: string };
  return { sid: sessionId, instanceId };
}

function edit(seq: number, tool: 'editCell' | 'convert'): LogOp {
  return {
    seq,
    opId: crypto.randomUUID(),
    kind: 'edit',
    label: 'x',
    tool,
    effect: {
      type: 'setCells',
      tableId: 't0',
      cells: [{ rowId: 0, colId: 'c0', value: { s: 0, r: `v${String(seq)}`, t: 0 } }],
    },
  };
}

async function sendOps(s: { sid: string; instanceId: string }, ops: LogOp[], ip: string) {
  const res = await api('/session/ops', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-session-id': s.sid, 'x-forwarded-for': ip },
    body: JSON.stringify({ instanceId: s.instanceId, ops }),
  });
  expect(res.status).toBe(200);
}

async function exportAs(s: { sid: string }, seq: number, format: 'xlsx' | 'json', ip: string) {
  const options =
    format === 'xlsx'
      ? { format, allSheets: false, header: true, nativeTypes: true }
      : { format, shape: 'objects', nested: true, indent: false };
  const res = await api('/session/export', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-session-id': s.sid, 'x-forwarded-for': ip },
    body: JSON.stringify({ expectedSeq: seq, fileName: `x.${format}`, tableIds: ['t0'], options }),
  });
  expect(res.status).toBe(200);
}

describe('login do painel', () => {
  it('sem usuário e senha no .env o painel não existe', async () => {
    await start({ metrics: { hmacKey: KEY, countExternal: true } });
    expect((await login()).status).toBe(404);
    expect((await get('/metrics/admin/summary')).status).toBe(404);
    expect((await get('/metrics/admin/me')).status).toBe(404);
  });

  it('usuário ou senha errados são recusados; o certo entra com cookie seguro', async () => {
    await start();
    expect((await login(USER, 'errada-errada-errada')).status).toBe(401);
    expect((await login('outro', PASSWORD)).status).toBe(401);
    const res = await login();
    expect(res.status).toBe(204);
    const set = res.headers.get('set-cookie') ?? '';
    expect(set).toMatch(/^dk_admin=[A-Za-z0-9_-]{43}; /);
    expect(set).toContain('HttpOnly');
    expect(set).toContain('SameSite=Strict');
    expect(set).toContain('Max-Age=43200');
    // Nos testes (http) não há Secure; em produção há (secureCookie = isProduction).
    expect(set).not.toContain('Secure');
    // O banco guarda só o hash do token.
    const token = set.split(';')[0]?.split('=')[1] ?? '';
    const stored = JSON.stringify(await server.db.metricsAdminSession.findMany());
    expect(stored).not.toContain(token);
  });

  it('todas as consultas exigem login; sair encerra o acesso', async () => {
    await start();
    for (const path of ['me', 'summary', 'visits', 'events', 'report']) {
      const res = await get(`/metrics/admin/${path}`);
      expect(res.status, path).toBe(401);
      expect(res.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    }
    const c = await cookie();
    expect((await get('/metrics/admin/me', c)).status).toBe(200);
    expect((await get('/metrics/admin/me', 'dk_admin=' + 'a'.repeat(43))).status).toBe(401);
    const out = await api('/metrics/admin/logout', { method: 'POST', headers: { cookie: c } });
    expect(out.status).toBe(204);
    expect(out.headers.get('set-cookie')).toContain('Max-Age=0');
    expect((await get('/metrics/admin/me', c)).status).toBe(401);
  });

  it('o login expira em 12 horas', async () => {
    await start();
    const c = await cookie();
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(Date.now() + 12 * 3_600_000 + 1000) });
    expect((await get('/metrics/admin/me', c)).status).toBe(401);
  });

  it(`limite de ${String(LOGIN_ATTEMPTS)} tentativas erradas por origem`, async () => {
    await start();
    for (let i = 0; i < LOGIN_ATTEMPTS; i += 1) {
      expect((await login(USER, 'errada-errada-errada')).status).toBe(401);
    }
    const blocked = await login();
    expect(blocked.status).toBe(429);
    expect(((await blocked.json()) as { error: { code: string } }).error.code).toBe(
      'TOO_MANY_ATTEMPTS',
    );
    // Outra origem não é afetada.
    expect((await login(USER, PASSWORD, '198.51.100.77')).status).toBe(204);
  });

  it('a senha nunca aparece em respostas nem nos logs', async () => {
    const lines: string[] = [];
    const capture = (...args: unknown[]) => {
      lines.push(args.map(String).join(' '));
    };
    const out = vi.spyOn(console, 'log').mockImplementation(capture);
    const err = vi.spyOn(console, 'error').mockImplementation(capture);
    vi.stubEnv('NODE_ENV', 'production');
    try {
      await start();
      const bad = await login(USER, 'tentativa-errada-xyz');
      const body = await bad.text();
      const c = await cookie();
      const me = await (await get('/metrics/admin/me', c)).text();
      const all = [body, me, lines.join('\n')].join('\n');
      expect(all).not.toContain(PASSWORD);
      expect(all).not.toContain('tentativa-errada-xyz');
      expect(lines.join('\n')).toContain('login do painel recusado');
    } finally {
      vi.unstubAllEnvs();
      out.mockRestore();
      err.mockRestore();
    }
  });
});

describe('números do painel', () => {
  /** Uso real pela API: 2 origens externas e o administrador logado. */
  async function scenario() {
    await start();
    const admin = await cookie();
    await visit('203.0.113.7');
    await visit('203.0.113.7'); // mesma origem em 10 min: não conta
    await visit('198.51.100.9');
    await visit('192.0.2.50', admin);

    const a = await openFile('203.0.113.7', 'a.csv', 'x;y\n1;2\n');
    await sendOps(a, [edit(1, 'editCell'), edit(2, 'convert')], '203.0.113.7');
    await exportAs(a, 2, 'xlsx', '203.0.113.7');
    await exportAs(a, 2, 'json', '203.0.113.7');

    // Importado e não exportado.
    await openFile('198.51.100.9', 'b.json', '[{"k":1}]');

    const mine = await openFile('192.0.2.50', 'teste.csv', 'x\n1\n', admin);
    await exportAs(mine, 0, 'json', '192.0.2.50');
    await server.metrics.flush();
    return admin;
  }

  it('cartões e gráficos batem com os registros do banco; o administrador fica à parte', async () => {
    const admin = await scenario();
    const res = await get('/metrics/admin/summary?period=30d', admin);
    expect(res.status).toBe(200);
    const s = (await res.json()) as Summary;
    expect(s.cards).toEqual({
      visitsTotal: 3,
      visitsExternal: 2,
      visitsAdmin: 1,
      distinctOrigins: 2,
      distinctOriginsIsDailySum: false,
      filesImported: 2,
      filesEdited: 1,
      filesExported: 1,
      completeSessions: 1,
      operations: 2,
    });
    expect(s.charts.importFormats).toEqual([
      { key: 'csv', count: 1 },
      { key: 'json', count: 1 },
    ]);
    expect(s.charts.exportFormats).toEqual([
      { key: 'json', count: 1 },
      { key: 'xlsx', count: 1 },
    ]);
    expect(s.charts.conversions).toEqual([
      { key: 'csv→json', count: 1 },
      { key: 'csv→xlsx', count: 1 },
    ]);
    expect(s.charts.tools).toEqual([
      { key: 'convert', count: 1 },
      { key: 'editCell', count: 1 },
    ]);
    const today = s.charts.visitsPerDay.at(-1);
    expect(today).toMatchObject({ external: 2, admin: 1 });
    expect(s.charts.cumulative.at(-1)).toMatchObject({ visits: 2, imports: 2, exports: 2 });
    expect(s.since).not.toBeNull();

    // Visão do administrador: só os testes dele.
    const mine = (await (
      await get('/metrics/admin/summary?period=30d&view=admin', admin)
    ).json()) as Summary;
    expect(mine.cards).toMatchObject({
      distinctOrigins: 1,
      filesImported: 1,
      filesExported: 1,
      completeSessions: 1,
      operations: 0,
    });
  });

  it('em "todo o período" as origens são a soma dia a dia, também depois da retenção', async () => {
    await start();
    const admin = await cookie();
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-09-01T15:00:00Z') });
    await visit('203.0.113.7');
    await visit('198.51.100.9');
    vi.setSystemTime(new Date('2026-09-02T15:00:00Z'));
    await visit('203.0.113.7');
    await server.metrics.flush();
    vi.setSystemTime(new Date('2026-11-04T15:00:00Z'));
    await purgeMetrics(server.db, 30, new Date('2026-09-03T15:00:00Z'));
    await purgeMetrics(server.db, 30);
    await server.db.metricsAdminSession.updateMany({
      data: { expiresAt: new Date('2026-11-05T00:00:00Z') },
    });
    const s = (await (await get('/metrics/admin/summary?period=all', admin)).json()) as Summary;
    expect(s.cards.distinctOrigins).toBe(3); // 2 no dia 1 + 1 no dia 2
    expect(s.cards.distinctOriginsIsDailySum).toBe(true);
    expect(s.cards.visitsExternal).toBe(3);
    const last30 = (await (
      await get('/metrics/admin/summary?period=30d', admin)
    ).json()) as Summary;
    expect(last30.cards.visitsExternal).toBe(0);
  });

  it('histórico de acessos: IP mascarado, mais recente primeiro, paginado e filtrado', async () => {
    await start();
    const admin = await cookie();
    for (let i = 1; i <= 55; i += 1) await visit(`203.0.113.${String(i)}`);
    await visit('192.0.2.50', admin);
    await server.metrics.flush();
    type Page = { rows: { maskedIp: string; classification: string }[]; total: number };
    const p1 = (await (await get('/metrics/admin/visits?page=1', admin)).json()) as Page;
    expect(p1.total).toBe(56);
    expect(p1.rows).toHaveLength(50);
    expect(p1.rows[0]).toMatchObject({ classification: 'admin', maskedIp: '1**.*.*.**' });
    const p2 = (await (await get('/metrics/admin/visits?page=2', admin)).json()) as Page;
    expect(p2.rows).toHaveLength(6);
    const ext = (await (
      await get('/metrics/admin/visits?classification=external', admin)
    ).json()) as Page;
    expect(ext.total).toBe(55);
    expect(JSON.stringify([p1, p2])).not.toContain('203.0.113');
    expect((await get('/metrics/admin/visits?page=0', admin)).status).toBe(400);
  });

  it('histórico de operações com filtros de tipo, formato e resultado', async () => {
    const admin = await scenario();
    type Page = {
      rows: {
        type: string;
        operation: string | null;
        sourceFormat: string;
        targetFormat: string;
      }[];
      total: number;
    };
    const all = (await (await get('/metrics/admin/events', admin)).json()) as Page;
    // 3 importações, 2 edições e 3 exportações.
    expect(all.total).toBe(8);
    const exports = (await (await get('/metrics/admin/events?type=export', admin)).json()) as Page;
    expect(exports.rows.map((r) => r.targetFormat).sort()).toEqual(['json', 'json', 'xlsx']);
    const edits = (await (await get('/metrics/admin/events?type=edit', admin)).json()) as Page;
    expect(edits.rows.map((r) => r.operation).sort()).toEqual(['convert', 'editCell']);
    const xlsx = (await (await get('/metrics/admin/events?format=xlsx', admin)).json()) as Page;
    expect(xlsx.total).toBe(1);
    const failed = (await (await get('/metrics/admin/events?ok=false', admin)).json()) as Page;
    expect(failed.total).toBe(0);
    expect((await get('/metrics/admin/events?type=nada', admin)).status).toBe(400);
  });

  it('relatório para baixar em CSV e JSON', async () => {
    const admin = await scenario();
    const csv = await get('/metrics/admin/report?period=30d&format=csv', admin);
    expect(csv.headers.get('content-disposition')).toBe(
      'attachment; filename="datakit-metricas-30d.csv"',
    );
    const text = await csv.text();
    expect(text).toContain('acessos_externos;2\r\n');
    expect(text).toContain('conversao_csv→xlsx;1\r\n');
    const json = (await (
      await get('/metrics/admin/report?period=30d&format=json', admin)
    ).json()) as Summary;
    expect(json.cards.filesImported).toBe(2);
  });
});
