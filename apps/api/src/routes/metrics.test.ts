import crypto from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LogOp } from '@datakit/core';
import { ADMIN_COOKIE, hashAdminToken } from '../metrics/adminSession.ts';
import { originHmac } from '../metrics/ip.ts';
import { purgeMetrics, saoPauloDay } from '../metrics/retention.ts';
import {
  startTestServer,
  upload,
  type TestServer,
  type TestServerOptions,
} from '../test/server.ts';

// Métricas de uso (docs/PROMPT-METRICAS.md, etapa M1): registro, deduplicação, classificação,
// privacidade e retenção.

const KEY = 'chave-de-teste-com-mais-de-32-caracteres';
let server: TestServer;
afterEach(async () => {
  vi.useRealTimers();
  await server.close();
});

async function start(options: TestServerOptions = {}) {
  server = await startTestServer({
    trustProxy: 1,
    metrics: { hmacKey: KEY, countExternal: true },
    ...options,
  });
  return server;
}

const bytes = (s: string) => new TextEncoder().encode(s);

function visit(ip?: string, headers: Record<string, string> = {}) {
  return fetch(`${server.baseUrl}/api/metrics/visit`, {
    method: 'POST',
    headers: { ...(ip ? { 'x-forwarded-for': ip } : {}), ...headers },
  });
}

async function visits() {
  await server.metrics.flush();
  return server.db.metricsVisit.findMany({ orderBy: { id: 'asc' } });
}

/** Login do painel feito direto no banco (o formulário de login é a etapa M2). */
async function adminCookie(): Promise<string> {
  const token = crypto.randomBytes(32).toString('base64url');
  await server.db.metricsAdminSession.create({
    data: { tokenHash: hashAdminToken(token), expiresAt: new Date(Date.now() + 3_600_000) },
  });
  return `${ADMIN_COOKIE}=${token}`;
}

function edit(seq: number, tool: 'editCell' | 'duplicates', text = 'novo'): LogOp {
  return {
    seq,
    opId: crypto.randomUUID(),
    kind: 'edit',
    label: 'Editar célula',
    tool,
    effect: {
      type: 'setCells',
      tableId: 't0',
      cells: [{ rowId: 0, colId: 'c0', value: { s: 0, r: text, t: 0 } }],
    },
  };
}

async function openFile(ip: string, name = 'clientes-secretos.csv', headers = {}) {
  const instanceId = crypto.randomUUID();
  const res = await fetch(`${server.baseUrl}/api/import`, {
    method: 'POST',
    headers: {
      'content-type': 'application/octet-stream',
      'x-file-name': encodeURIComponent(name),
      'x-instance-id': instanceId,
      'x-forwarded-for': ip,
      ...headers,
    },
    body: bytes('nome;cpf\nAna;123.456.789-00\n'),
  });
  expect(res.status).toBe(201);
  const { sessionId } = (await res.json()) as { sessionId: string };
  return { sid: sessionId, instanceId };
}

function sendOps(sid: string, instanceId: string, ops: unknown[], ip: string) {
  return fetch(`${server.baseUrl}/api/session/ops`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-session-id': sid, 'x-forwarded-for': ip },
    body: JSON.stringify({ instanceId, ops }),
  });
}

function exportCsv(sid: string, seq: number, ip: string) {
  return fetch(`${server.baseUrl}/api/session/export`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-session-id': sid, 'x-forwarded-for': ip },
    body: JSON.stringify({
      expectedSeq: seq,
      fileName: 'saida.json',
      tableIds: ['t0'],
      options: { format: 'json', shape: 'objects', nested: true, indent: false },
    }),
  });
}

describe('acessos', () => {
  it('sem METRICS_HMAC_KEY nada é registrado', async () => {
    await start({ metrics: { hmacKey: undefined, countExternal: true } });
    expect((await visit('203.0.113.7')).status).toBe(204);
    expect(await visits()).toEqual([]);
  });

  it('a mesma origem conta uma vez em 10 minutos e de novo depois deles', async () => {
    await start();
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-04T12:00:00Z') });
    await visit('203.0.113.7');
    await visit('203.0.113.7');
    vi.setSystemTime(new Date('2026-11-04T12:09:59Z'));
    await visit('203.0.113.7');
    expect(await visits()).toHaveLength(1);
    vi.setSystemTime(new Date('2026-11-04T12:10:00Z'));
    await visit('203.0.113.7');
    // Outra origem não é afetada pela janela da primeira.
    await visit('198.51.100.9');
    const rows = await visits();
    expect(rows.map((r) => r.maskedIp)).toEqual(['20*.*.***.*', '20*.*.***.*', '198.**.***.*']);
  });

  it('requisições simultâneas da mesma origem contam uma vez só', async () => {
    await start();
    const all = await Promise.all(Array.from({ length: 25 }, () => visit('203.0.113.7')));
    expect(all.every((r) => r.status === 204)).toBe(true);
    expect(await visits()).toHaveLength(1);
  });

  it('o IP completo nunca é gravado; só o HMAC e a forma mascarada', async () => {
    await start();
    await visit('2804:14c:5b8a:1234::1');
    const [row] = await visits();
    expect(row?.originHmac).toBe(originHmac('2804:14c:5b8a:1234::1', KEY));
    expect(row?.maskedIp).toBe('2804:14c:5b8*:****::*');
    expect(JSON.stringify(row)).not.toContain('1234::1');
  });

  it('X-Forwarded-For forjado é ignorado sem proxy confiável', async () => {
    await start({ trustProxy: 0 });
    await visit('203.0.113.7');
    const [row] = await visits();
    // Vale o IP de quem conectou (o próprio teste), não o cabeçalho.
    expect(row?.maskedIp).not.toContain('203');
    expect(row?.originHmac).toBe(originHmac('127.0.0.1', KEY));
  });

  it('navegador logado no painel é administrativo; sem login, externo; fora de produção, dev', async () => {
    await start();
    const cookie = await adminCookie();
    await visit('203.0.113.7', { cookie });
    await visit('198.51.100.9');
    await visit('192.0.2.1', { cookie: `${ADMIN_COOKIE}=${'x'.repeat(43)}` });
    expect((await visits()).map((r) => r.classification)).toEqual([
      'admin',
      'external',
      'external',
    ]);
    await server.close();

    await start({ metrics: { hmacKey: KEY, countExternal: false } });
    await visit('203.0.113.7');
    expect((await visits()).map((r) => r.classification)).toEqual(['dev']);
  });
});

describe('uso dos arquivos', () => {
  it('importação, edição (com a ferramenta), desfazer, refazer e exportação, ligados à origem', async () => {
    await start();
    const ip = '203.0.113.7';
    const { sid, instanceId } = await openFile(ip);
    const ops = [
      edit(1, 'editCell'),
      edit(2, 'duplicates', 'outro'),
      { seq: 3, opId: crypto.randomUUID(), kind: 'undo' },
      { seq: 4, opId: crypto.randomUUID(), kind: 'redo' },
    ];
    expect((await sendOps(sid, instanceId, ops, ip)).status).toBe(200);
    // Reenvio (F5, rede) não conta de novo.
    expect((await sendOps(sid, instanceId, ops, ip)).status).toBe(200);
    expect((await exportCsv(sid, 4, ip)).status).toBe(200);
    await server.metrics.flush();

    const imports = await server.db.metricsImport.findMany();
    expect(imports).toHaveLength(1);
    const imp = imports[0];
    expect(imp).toMatchObject({ format: 'csv', ok: true, classification: 'external' });
    expect(imp?.sizeBytes).toBeGreaterThan(0);
    expect(imp?.originHmac).toBe(originHmac(ip, KEY));

    const edits = await server.db.metricsEdit.findMany({ orderBy: { id: 'asc' } });
    expect(edits.map((e) => [e.kind, e.tool])).toEqual([
      ['edit', 'editCell'],
      ['edit', 'duplicates'],
      ['undo', null],
      ['redo', null],
    ]);
    expect(edits.every((e) => e.importId === imp?.id && e.sourceFormat === 'csv')).toBe(true);

    const exports = await server.db.metricsExport.findMany();
    expect(exports).toEqual([
      expect.objectContaining({
        importId: imp?.id,
        sourceFormat: 'csv',
        targetFormat: 'json',
        ok: true,
        originHmac: originHmac(ip, KEY),
      }),
    ]);
  });

  it('nada do conteúdo, do nome do arquivo ou das linhas vai para as métricas', async () => {
    await start();
    const ip = '203.0.113.7';
    const { sid, instanceId } = await openFile(ip);
    await sendOps(sid, instanceId, [edit(1, 'editCell', 'valor-digitado')], ip);
    await exportCsv(sid, 1, ip);
    await server.metrics.flush();
    const all = JSON.stringify(
      await Promise.all([
        server.db.metricsImport.findMany(),
        server.db.metricsEdit.findMany(),
        server.db.metricsExport.findMany(),
        server.db.metricsSession.findMany(),
      ]),
      (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v),
    );
    for (const secret of [
      'clientes-secretos',
      'saida',
      'Ana',
      '123.456',
      'cpf',
      'valor-digitado',
    ]) {
      expect(all).not.toContain(secret);
    }
    expect(all).not.toContain('203.0.113.7');
  });

  it('falhas de importação e lotes inválidos são registrados com o código, sem mensagem', async () => {
    await start();
    const res = await upload(server, 'quebrado.json', bytes('{"a": '));
    expect(res.status).toBe(422);
    const { sid } = await openFile('203.0.113.7');
    const bad = await sendOps(sid, crypto.randomUUID(), [{ seq: 1, kind: 'nada' }], '203.0.113.7');
    expect(bad.status).toBe(422);
    await server.metrics.flush();
    const failed = await server.db.metricsImport.findFirst({ where: { ok: false } });
    expect(failed).toMatchObject({ format: 'json', errorCode: 'INVALID_FILE' });
    const rejected = await server.db.metricsEdit.findMany();
    expect(rejected).toEqual([expect.objectContaining({ ok: false, tool: null })]);
  });

  it('o editor continua funcionando se gravar uma métrica falhar', async () => {
    await start();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await server.db.$executeRawUnsafe('DROP TABLE "MetricsEdit"');
      const { sid, instanceId } = await openFile('203.0.113.7');
      const res = await sendOps(sid, instanceId, [edit(1, 'editCell')], '203.0.113.7');
      expect(res.status).toBe(200);
      expect(((await res.json()) as { ackedSeq: number }).ackedSeq).toBe(1);
      await server.metrics.flush();
      expect(errors.mock.calls.join('\n')).toContain('falha ao registrar métrica');
    } finally {
      errors.mockRestore();
    }
  });
});

describe('retenção', () => {
  it('depois de 30 dias apaga HMAC, IP mascarado e sessão; guarda as origens por dia', async () => {
    await start();
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-01T15:00:00Z') });
    await visit('203.0.113.7');
    await visit('198.51.100.9');
    const { sid, instanceId } = await openFile('203.0.113.7');
    await sendOps(sid, instanceId, [edit(1, 'editCell')], '203.0.113.7');
    await server.metrics.flush();

    // Um dia depois, o dia 1º já foi resumido.
    await purgeMetrics(server.db, 30, new Date('2026-10-02T15:00:00Z'));
    expect(await server.db.metricsDaily.findMany()).toEqual([
      { day: '2026-10-01', classification: 'external', distinctOrigins: 2 },
    ]);

    // 31 dias depois, os identificadores somem; os registros e o total do dia ficam.
    await purgeMetrics(server.db, 30, new Date('2026-11-01T16:00:00Z'));
    const rows = await server.db.metricsVisit.findMany();
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.originHmac === null && r.maskedIp === null)).toBe(true);
    const editsLeft = await server.db.metricsEdit.findMany();
    expect(editsLeft).toEqual([
      expect.objectContaining({
        originHmac: null,
        maskedIp: null,
        sessionHash: null,
        tool: 'editCell',
      }),
    ]);
    expect(await server.db.metricsSession.count()).toBe(0);
    expect(await server.db.metricsOriginLast.count()).toBe(0);
    expect(await server.db.metricsDaily.findMany()).toEqual([
      { day: '2026-10-01', classification: 'external', distinctOrigins: 2 },
    ]);
    expect(saoPauloDay(new Date('2026-10-02T02:59:59Z'))).toBe('2026-10-01');
  });
});
