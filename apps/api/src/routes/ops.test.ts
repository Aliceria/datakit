import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyChunk,
  applyLogOp,
  deserializeMarks,
  emptyHistory,
  readCell,
  tableFromManifest,
  type ChunkPayload,
  type DocumentManifest,
  type LogOp,
  type Table,
} from '@datakit/core';
import { COMPACT_EVERY_OPS, compactSession } from '../services/compactionService.ts';
import { hashToken } from '../services/sessionService.ts';
import { startTestServer, upload, type TestServer } from '../test/server.ts';

let server: TestServer;
afterEach(async () => {
  await server.close();
});

const csv = (s: string) => new TextEncoder().encode(s);

async function open(content = 'a;b\n1;2\n3;4\n') {
  server = await startTestServer();
  const instanceId = crypto.randomUUID();
  const res = await upload(server, 'dados.csv', csv(content), { instanceId });
  const { sessionId } = (await res.json()) as { sessionId: string };
  return { sid: sessionId, instanceId };
}

function setText(seq: number, rowId: number, colId: string, text: string): LogOp {
  return {
    seq,
    opId: crypto.randomUUID(),
    kind: 'edit',
    label: 'Editar célula',
    effect: {
      type: 'setCells',
      tableId: 't0',
      cells: [{ rowId, colId, value: { s: 0, r: text, t: 0 } }],
    },
  };
}

async function sendOps(
  sid: string,
  instanceId: string,
  ops: LogOp[],
  gzipBody = false,
): Promise<Response> {
  const json = JSON.stringify({ instanceId, ops });
  return fetch(`${server.baseUrl}/api/session/ops`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-session-id': sid,
      ...(gzipBody ? { 'content-encoding': 'gzip' } : {}),
    },
    body: gzipBody ? zlib.gzipSync(json) : json,
  });
}

type Loaded = { manifest: DocumentManifest; tables: Table[]; version: number };

/** Carrega como o navegador: estado → manifesto e blocos da versão → operações depois do snapshot. */
async function load(sid: string): Promise<Loaded> {
  const headers = { 'x-session-id': sid };
  const state = (await (
    await fetch(`${server.baseUrl}/api/session/state`, { headers })
  ).json()) as {
    snapshotVersion: number;
    snapshotSeq: number;
  };
  const v = state.snapshotVersion;
  const manifest = (await (
    await fetch(`${server.baseUrl}/api/session/manifest?v=${String(v)}`, { headers })
  ).json()) as DocumentManifest;
  const tables = manifest.tables.map(tableFromManifest);
  for (const tm of manifest.tables) {
    for (const index of tm.chunks) {
      const r = await fetch(
        `${server.baseUrl}/api/session/chunks/${tm.id}/${String(index)}?v=${String(v)}`,
        { headers },
      );
      const table = tables.find((t) => t.id === tm.id);
      if (table) applyChunk(table, (await r.json()) as ChunkPayload);
    }
  }
  const opsRes = await fetch(
    `${server.baseUrl}/api/session/ops?after=${String(state.snapshotSeq)}`,
    { headers },
  );
  expect(opsRes.status).toBe(200);
  const editor = {
    tables,
    history: manifest.history ?? emptyHistory(),
    marks: deserializeMarks(manifest.marks),
  };
  for (const op of (await opsRes.json()) as LogOp[]) applyLogOp(editor, op);
  return { manifest, tables, version: v };
}

const values = (t: Table) =>
  t.rowOrder.map((rowId) => t.columns.map((c) => readCell(t.data.get(c.id) ?? fail(), rowId).raw));
const fail = (): never => {
  throw new Error('coluna ausente');
};

describe('POST /api/session/ops', () => {
  it('grava em sequência e o estado recarregado inclui as operações', async () => {
    const { sid, instanceId } = await open();
    const res = await sendOps(sid, instanceId, [
      setText(1, 0, 'c0', 'x'),
      setText(2, 1, 'c1', 'y'),
    ]);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ackedSeq: 2 });
    expect(values((await load(sid)).tables[0] as Table)).toEqual([
      ['x', '2'],
      ['3', 'y'],
    ]);
  });

  it('aceita corpo compactado (colagens grandes)', async () => {
    const { sid, instanceId } = await open();
    const res = await sendOps(sid, instanceId, [setText(1, 0, 'c0', 'z'.repeat(200_000))], true);
    expect(res.status).toBe(200);
  });

  it('reenvio da mesma operação é ignorado (idempotente)', async () => {
    const { sid, instanceId } = await open();
    const op = setText(1, 0, 'c0', 'x');
    await sendOps(sid, instanceId, [op]);
    const again = await sendOps(sid, instanceId, [op, setText(2, 0, 'c1', 'w')]);
    expect(await again.json()).toEqual({ ackedSeq: 2 });
  });

  it('lacuna: 409 SEQ_GAP com a cabeça do servidor', async () => {
    const { sid, instanceId } = await open();
    const res = await sendOps(sid, instanceId, [setText(3, 0, 'c0', 'x')]);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: 'SEQ_GAP', details: { headSeq: 0 } } });
  });

  it('conflito: mesma sequência com outra operação', async () => {
    const { sid, instanceId } = await open();
    await sendOps(sid, instanceId, [setText(1, 0, 'c0', 'x')]);
    const res = await sendOps(sid, instanceId, [setText(1, 0, 'c0', 'outra')]);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: 'SEQ_CONFLICT' } });
  });

  it('só a instância ativa escreve', async () => {
    const { sid } = await open();
    const res = await sendOps(sid, crypto.randomUUID(), [setText(1, 0, 'c0', 'x')]);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: 'INSTANCE_REPLACED' } });
  });

  it('formato inválido é recusado', async () => {
    const { sid, instanceId } = await open();
    const bad = {
      seq: 1,
      opId: crypto.randomUUID(),
      kind: 'edit',
      label: 'x',
      effect: { type: 'apagarTudo' },
    };
    const res = await fetch(`${server.baseUrl}/api/session/ops`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-session-id': sid },
      body: JSON.stringify({ instanceId, ops: [bad] }),
    });
    expect(res.status).toBe(422);
  });

  it('a sessão A não escreve na sessão B', async () => {
    const a = await open('x\nA\n');
    const resB = await upload(server, 'b.csv', csv('x\nB\n'), { instanceId: crypto.randomUUID() });
    const { sessionId: sidB } = (await resB.json()) as { sessionId: string };
    await sendOps(a.sid, a.instanceId, [setText(1, 0, 'c0', 'mudou')]);
    expect(values((await load(sidB)).tables[0] as Table)).toEqual([['B']]);
  });

  it('desfazer e refazer vão para o log e voltam depois do recarregamento', async () => {
    const { sid, instanceId } = await open();
    await sendOps(sid, instanceId, [
      setText(1, 0, 'c0', 'x'),
      setText(2, 0, 'c0', 'y'),
      { seq: 3, opId: crypto.randomUUID(), kind: 'undo' },
    ]);
    const loaded = await load(sid);
    expect(values(loaded.tables[0] as Table)[0]).toEqual(['x', '2']);
  });

  it('beacon do pagehide também entrega operações pendentes', async () => {
    const { sid, instanceId } = await open();
    await fetch(`${server.baseUrl}/api/session/release`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify({ sid, instanceId, ops: [setText(1, 0, 'c0', 'via beacon')] }),
    });
    await fetch(`${server.baseUrl}/api/session/resume`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-session-id': sid },
      body: JSON.stringify({ instanceId: crypto.randomUUID() }),
    });
    expect(values((await load(sid)).tables[0] as Table)[0]).toEqual(['via beacon', '2']);
  });
});

describe('compactação', () => {
  it(`a cada ${String(COMPACT_EVERY_OPS)} operações o snapshot avança, com histórico e marcas`, async () => {
    const { sid, instanceId } = await open();
    const ops: LogOp[] = [];
    for (let seq = 1; seq <= COMPACT_EVERY_OPS + 5; seq += 1)
      ops.push(setText(seq, 0, 'c0', `v${String(seq)}`));
    ops.push({ seq: COMPACT_EVERY_OPS + 6, opId: crypto.randomUUID(), kind: 'undo' });
    for (let i = 0; i < ops.length; i += 100) {
      expect((await sendOps(sid, instanceId, ops.slice(i, i + 100))).status).toBe(200);
    }
    // A compactação automática começou em segundo plano ao chegar a 200 operações; a primeira
    // chamada espera por ela, e a segunda inclui as operações que chegaram depois.
    await compactSession(server.db, hashToken(sid));
    await compactSession(server.db, hashToken(sid));

    const session = await server.db.session.findUniqueOrThrow({ where: { id: hashToken(sid) } });
    expect(session.snapshotVersion).toBeGreaterThan(1);
    expect(session.snapshotSeq).toBe(COMPACT_EVERY_OPS + 6);

    const loaded = await load(sid);
    expect(values(loaded.tables[0] as Table)[0]).toEqual([
      `v${String(COMPACT_EVERY_OPS + 4)}`,
      '2',
    ]);
    // 100 no histórico; o desfazer final moveu uma para o refazer.
    expect(loaded.manifest.history?.undo.length).toBe(99);
    expect(loaded.manifest.history?.redo.length).toBe(1);
    expect(loaded.manifest.marks?.changes).toBe(COMPACT_EVERY_OPS + 6);
    expect(loaded.manifest.marks?.tables['t0']?.cells).toContain('0:c0');

    // A versão anterior continua legível por uma rodada.
    const prev = await fetch(
      `${server.baseUrl}/api/session/manifest?v=${String(loaded.version - 1)}`,
      {
        headers: { 'x-session-id': sid },
      },
    );
    expect(prev.headers.get('x-snapshot-version')).toBe(String(loaded.version - 1));
  });

  it('operações depois da compactação continuam a sequência', async () => {
    const { sid, instanceId } = await open();
    const ops: LogOp[] = [];
    for (let seq = 1; seq <= 3; seq += 1) ops.push(setText(seq, 1, 'c1', `w${String(seq)}`));
    await sendOps(sid, instanceId, ops);
    await compactSession(server.db, hashToken(sid));
    expect((await sendOps(sid, instanceId, [setText(4, 0, 'c0', 'depois')])).status).toBe(200);
    expect(values((await load(sid)).tables[0] as Table)).toEqual([
      ['depois', '2'],
      ['3', 'w3'],
    ]);
  });

  it('pedir operações já compactadas pede recomeço', async () => {
    const { sid, instanceId } = await open();
    await sendOps(sid, instanceId, [setText(1, 0, 'c0', 'a'), setText(2, 0, 'c0', 'b')]);
    await compactSession(server.db, hashToken(sid));
    await sendOps(sid, instanceId, [setText(3, 0, 'c0', 'c')]);
    await compactSession(server.db, hashToken(sid));
    const res = await fetch(`${server.baseUrl}/api/session/ops?after=0`, {
      headers: { 'x-session-id': sid },
    });
    expect(res.status).toBe(409);
  });
});
