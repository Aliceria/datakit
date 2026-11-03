import crypto from 'node:crypto';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyChunk,
  encodeDocument,
  readCell,
  tableFromManifest,
  type ChunkPayload,
  type DocumentManifest,
  type Table,
} from '@datakit/core';
import { hashToken } from '../services/sessionService.ts';
import {
  startTestServer,
  upload,
  type TestServer,
  type TestServerOptions,
} from '../test/server.ts';

const GRACE_MS = 400;
const csv = (s: string) => new TextEncoder().encode(s);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

let server: TestServer;
afterEach(async () => {
  await server.close();
});

async function start(options: TestServerOptions = {}) {
  server = await startTestServer({ limits: { deleteAfterCloseMs: GRACE_MS }, ...options });
  return server;
}

function post(path: string, body: unknown, sid?: string): Promise<Response> {
  return fetch(`${server.baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(sid ? { 'x-session-id': sid } : {}) },
    body: JSON.stringify(body),
  });
}

/** O beacon do pagehide: text/plain, token no corpo. */
function release(sid: string, instanceId: string): Promise<Response> {
  return fetch(`${server.baseUrl}/api/session/release`, {
    method: 'POST',
    headers: { 'content-type': 'text/plain;charset=UTF-8' },
    body: JSON.stringify({ sid, instanceId }),
  });
}

async function openSession(content = 'nome;valor\nAna;1\n', instanceId = crypto.randomUUID()) {
  const res = await upload(server, 'dados.csv', csv(content), { instanceId });
  expect(res.status).toBe(201);
  const { sessionId } = (await res.json()) as { sessionId: string };
  return { sid: sessionId, instanceId };
}

async function loadTables(sid: string) {
  const headers = { 'x-session-id': sid };
  const manifestRes = await fetch(`${server.baseUrl}/api/session/manifest`, { headers });
  expect(manifestRes.status).toBe(200);
  const manifest = (await manifestRes.json()) as DocumentManifest;
  const tables: Table[] = [];
  for (const tm of manifest.tables) {
    const table = tableFromManifest(tm);
    for (const index of tm.chunks) {
      const r = await fetch(`${server.baseUrl}/api/session/chunks/${tm.id}/${String(index)}`, {
        headers,
      });
      applyChunk(table, (await r.json()) as ChunkPayload);
    }
    tables.push(table);
  }
  return { manifest, tables };
}

function values(table: Table): string[][] {
  return table.rowOrder.map((rowId) =>
    table.columns.map((c) => {
      const data = table.data.get(c.id);
      return data ? readCell(data, rowId).raw : '?';
    }),
  );
}

describe('F5 e reabrir a aba (retomar)', () => {
  it('o pagehide agenda a exclusão e a retomada dentro do prazo cancela', async () => {
    await start();
    const { sid, instanceId } = await openSession();
    expect((await release(sid, instanceId)).status).toBe(204);
    const row = await server.db.session.findUniqueOrThrow({ where: { id: hashToken(sid) } });
    expect(row.deleteAt).not.toBeNull();

    const newInstance = crypto.randomUUID();
    const res = await post('/api/session/resume', { instanceId: newInstance }, sid);
    expect(res.status).toBe(200);
    const after = await server.db.session.findUniqueOrThrow({ where: { id: hashToken(sid) } });
    expect(after.deleteAt).toBeNull();
    expect(after.activeInstanceId).toBe(newInstance);

    await wait(GRACE_MS + 100);
    expect((await post('/api/session/heartbeat', { instanceId: newInstance }, sid)).status).toBe(
      204,
    );
  });

  it('beacon atrasado da página antiga, depois da retomada, é ignorado (L11)', async () => {
    await start();
    const { sid, instanceId: oldInstance } = await openSession();
    const newInstance = crypto.randomUUID();
    // A página nova retoma antes de o beacon da antiga chegar.
    expect((await post('/api/session/resume', { instanceId: newInstance }, sid)).status).toBe(200);
    expect((await release(sid, oldInstance)).status).toBe(204);
    const row = await server.db.session.findUniqueOrThrow({ where: { id: hashToken(sid) } });
    expect(row.deleteAt).toBeNull();
  });

  it('fora do prazo, a sessão está expirada', async () => {
    await start();
    const { sid, instanceId } = await openSession();
    await release(sid, instanceId);
    await wait(GRACE_MS + 100);
    const res = await post('/api/session/resume', { instanceId: crypto.randomUUID() }, sid);
    expect(res.status).toBe(410);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('SESSION_EXPIRED');
  });

  it('release com corpo inválido não faz nada e não revela nada', async () => {
    await start();
    const { sid } = await openSession();
    for (const body of [
      'lixo',
      JSON.stringify({ sid }),
      JSON.stringify({ sid: 'x', instanceId: 'y' }),
    ]) {
      const res = await fetch(`${server.baseUrl}/api/session/release`, {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body,
      });
      expect(res.status).toBe(204);
    }
    const row = await server.db.session.findUniqueOrThrow({ where: { id: hashToken(sid) } });
    expect(row.deleteAt).toBeNull();
  });
});

describe('heartbeat e instância ativa', () => {
  it('outra instância recebe INSTANCE_REPLACED; a ativa segue normal', async () => {
    await start();
    const { sid, instanceId } = await openSession();
    expect((await post('/api/session/heartbeat', { instanceId }, sid)).status).toBe(204);
    const other = await post('/api/session/heartbeat', { instanceId: crypto.randomUUID() }, sid);
    expect(other.status).toBe(409);
    expect(((await other.json()) as { error: { code: string } }).error.code).toBe(
      'INSTANCE_REPLACED',
    );
  });

  it('heartbeat da instância ativa desfaz uma exclusão agendada por engano', async () => {
    await start();
    const { sid, instanceId } = await openSession();
    await release(sid, instanceId);
    expect((await post('/api/session/heartbeat', { instanceId }, sid)).status).toBe(204);
    const row = await server.db.session.findUniqueOrThrow({ where: { id: hashToken(sid) } });
    expect(row.deleteAt).toBeNull();
  });

  it('sessão inativa há mais de 2 h expira', async () => {
    await start();
    const { sid, instanceId } = await openSession();
    await server.db.session.updateMany({
      data: { lastSeenAt: new Date(Date.now() - 2 * 3_600_000 - 1000) },
    });
    expect((await post('/api/session/heartbeat', { instanceId }, sid)).status).toBe(410);
  });

  it('duração máxima de 24 h', async () => {
    await start();
    const { sid, instanceId } = await openSession();
    await server.db.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await post('/api/session/heartbeat', { instanceId }, sid)).status).toBe(410);
  });

  it('pedido sem instanceId válido é recusado', async () => {
    await start();
    const { sid } = await openSession();
    expect((await post('/api/session/heartbeat', { instanceId: 'abc' }, sid)).status).toBe(400);
    expect((await post('/api/session/heartbeat', {}, sid)).status).toBe(400);
  });
});

describe('duplicar aba (fork)', () => {
  it('cria uma sessão independente com cópia dos dados atuais', async () => {
    await start();
    const { sid } = await openSession('nome;cep\nAna;01310100\n');
    const copyInstance = crypto.randomUUID();
    const res = await post('/api/session/fork', { instanceId: copyInstance }, sid);
    expect(res.status).toBe(201);
    const { sessionId: copy } = (await res.json()) as { sessionId: string };
    expect(copy).not.toBe(sid);

    const original = await loadTables(sid);
    const copied = await loadTables(copy);
    expect(values(copied.tables[0] as Table)).toEqual(values(original.tables[0] as Table));
    expect(copied.manifest.source).toEqual(original.manifest.source);

    // A cópia já tem dona e não estende o prazo máximo da original.
    const [a, b] = await Promise.all([
      server.db.session.findUniqueOrThrow({ where: { id: hashToken(sid) } }),
      server.db.session.findUniqueOrThrow({ where: { id: hashToken(copy) } }),
    ]);
    expect(b.activeInstanceId).toBe(copyInstance);
    expect(b.expiresAt.getTime()).toBe(a.expiresAt.getTime());

    // Independentes: apagar a cópia não afeta a original.
    await fetch(`${server.baseUrl}/api/session`, {
      method: 'DELETE',
      headers: { 'x-session-id': copy },
    });
    expect((await loadTables(sid)).tables[0]?.rowOrder).toHaveLength(1);
  });

  it('a cópia conta no limite de sessões por IP', async () => {
    await start({ limits: { activeSessionsPerIp: 1 } });
    const { sid } = await openSession();
    const res = await post('/api/session/fork', { instanceId: crypto.randomUUID() }, sid);
    expect(res.status).toBe(429);
  });

  it('não copia sessão expirada', async () => {
    await start();
    const { sid } = await openSession();
    await server.db.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1) } });
    expect((await post('/api/session/fork', { instanceId: crypto.randomUUID() }, sid)).status).toBe(
      410,
    );
  });
});

describe('limpeza física', () => {
  /** Lê o banco e o WAL do disco. */
  const diskBytes = () =>
    Buffer.concat(
      [server.dbFile, `${server.dbFile}-wal`]
        .filter((f) => fs.existsSync(f))
        .map((f) => fs.readFileSync(f)),
    );

  it('apaga a sessão no fim do prazo e os bytes somem do arquivo do banco', async () => {
    await start({ withCleanup: true });
    const marker = `marcador-${crypto.randomBytes(12).toString('hex')}`;
    const instanceId = crypto.randomUUID();
    const res = await upload(server, `${marker}.csv`, csv(`coluna\n${'x'.repeat(5000)}\n`), {
      instanceId,
    });
    const { sessionId: sid } = (await res.json()) as { sessionId: string };
    const blob = (await server.db.snapshotChunk.findFirstOrThrow()).data;
    const probe = Buffer.from(blob).subarray(10, 42);
    await server.db.$queryRawUnsafe('PRAGMA wal_checkpoint(TRUNCATE)');
    expect(diskBytes().includes(marker)).toBe(true);
    expect(diskBytes().includes(probe)).toBe(true);

    await release(sid, instanceId);
    await wait(GRACE_MS + 800);

    expect(await server.db.session.count()).toBe(0);
    expect(await server.db.snapshotChunk.count()).toBe(0);
    const bytes = diskBytes();
    expect(bytes.includes(marker)).toBe(false);
    expect(bytes.includes(probe)).toBe(false);
  });

  it('a limpeza apaga sessões inativas, vencidas e com exclusão agendada, e mantém as ativas', async () => {
    await start({ withCleanup: true });
    const active = await openSession();
    const inactive = await openSession();
    const old = await openSession();
    const released = await openSession();
    await server.db.session.update({
      where: { id: hashToken(inactive.sid) },
      data: { lastSeenAt: new Date(Date.now() - 3 * 3_600_000) },
    });
    await server.db.session.update({
      where: { id: hashToken(old.sid) },
      data: { expiresAt: new Date(Date.now() - 1) },
    });
    await server.db.session.update({
      where: { id: hashToken(released.sid) },
      data: { deleteAt: new Date(Date.now() - 1) },
    });
    expect(await server.cleanup?.runNow()).toBe(3);
    const left = await server.db.session.findMany({ select: { id: true } });
    expect(left.map((s) => s.id)).toEqual([hashToken(active.sid)]);
  });
});

describe('continuar em uma nova sessão (L14)', () => {
  async function restorePayload(sid: string): Promise<Uint8Array> {
    const { manifest, tables } = await loadTables(sid);
    const encoded = encodeDocument({ source: manifest.source, tables, warnings: [] });
    return zlib.gzipSync(JSON.stringify(encoded));
  }

  function restore(body: Uint8Array): Promise<Response> {
    return fetch(`${server.baseUrl}/api/session/restore`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream', 'x-instance-id': crypto.randomUUID() },
      body,
    });
  }

  it('recria a sessão com os mesmos dados', async () => {
    await start();
    const { sid } = await openSession('cep;id\n01310100;12345678901234567890\n;x\n');
    const payload = await restorePayload(sid);
    await fetch(`${server.baseUrl}/api/session`, {
      method: 'DELETE',
      headers: { 'x-session-id': sid },
    });

    const res = await restore(payload);
    expect(res.status).toBe(201);
    const { sessionId } = (await res.json()) as { sessionId: string };
    const { tables, manifest } = await loadTables(sessionId);
    expect(values(tables[0] as Table)).toEqual([
      ['01310100', '12345678901234567890'],
      ['', 'x'],
    ]);
    expect(manifest.source.fileName).toBe('dados.csv');
  });

  it('recusa dados malformados', async () => {
    await start();
    const { sid } = await openSession();
    const good = JSON.parse(zlib.gunzipSync(await restorePayload(sid)).toString()) as {
      chunks: Array<{ payload: { rowIds: number[] } }>;
      manifest: { tables: Array<{ rowOrder: number[] }> };
    };
    const variants = [
      Buffer.from('não é gzip'),
      zlib.gzipSync('{"a":1}'),
      zlib.gzipSync(JSON.stringify({ ...good, extra: true })),
      zlib.gzipSync(
        JSON.stringify({
          ...good,
          manifest: { ...good.manifest, tables: [{ ...good.manifest.tables[0], rowOrder: [999] }] },
        }),
      ),
    ];
    for (const body of variants) {
      const res = await restore(body);
      expect(res.status).toBe(422);
    }
  });
});
