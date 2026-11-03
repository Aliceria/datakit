import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  LIMITS,
  applyChunk,
  readCell,
  tableFromManifest,
  type DocumentManifest,
  type ChunkPayload,
  type Table,
} from '@datakit/core';
import { hashToken } from '../services/sessionService.ts';
import { fixture, startTestServer, upload, type TestServer } from '../test/server.ts';

type ImportBody = {
  sessionId?: string;
  version: number;
  warnings: Array<{ code: string; message: string }>;
  tables: Array<{ id: string; name: string; rows: number; columns: number }>;
};
type ErrorBody = { error: { code: string; message: string } };

const csv = (s: string) => new TextEncoder().encode(s);

async function loadDocument(server: TestServer, sessionId: string) {
  const res = await fetch(`${server.baseUrl}/api/session/manifest`, {
    headers: { 'x-session-id': sessionId },
  });
  expect(res.status).toBe(200);
  const manifest = (await res.json()) as DocumentManifest;
  const tables: Table[] = [];
  for (const tm of manifest.tables) {
    const table = tableFromManifest(tm);
    for (const index of tm.chunks) {
      const chunk = await fetch(`${server.baseUrl}/api/session/chunks/${tm.id}/${index}`, {
        headers: { 'x-session-id': sessionId },
      });
      expect(chunk.status).toBe(200);
      applyChunk(table, (await chunk.json()) as ChunkPayload);
    }
    tables.push(table);
  }
  return { manifest, tables };
}

function rows(table: Table): string[][] {
  return table.rowOrder.map((rowId) =>
    table.columns.map((c) => {
      const data = table.data.get(c.id);
      return data ? readCell(data, rowId).raw : '?';
    }),
  );
}

describe('importação', () => {
  let server: TestServer;
  beforeAll(async () => {
    server = await startTestServer();
  });
  afterAll(async () => {
    await server.close();
  });

  it('CSV do Excel em português: cria a sessão e devolve os dados exatos', async () => {
    const res = await upload(server, 'vendas.csv', fixture('csv/excel-br-1252.csv'));
    expect(res.status).toBe(201);
    const body = (await res.json()) as ImportBody;
    expect(body.sessionId).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(body.tables).toEqual([
      { id: 't0', name: 'vendas.csv', rows: 3, columns: 4, hidden: false },
    ]);

    const { manifest, tables } = await loadDocument(server, body.sessionId ?? '');
    expect(manifest.source).toMatchObject({
      fileName: 'vendas.csv',
      format: 'csv',
      encoding: 'windows-1252',
      delimiter: ';',
      hasHeader: true,
    });
    expect(rows(tables[0] as Table)[1]).toEqual(['João', '89,90', '15/03/2024', 'Açú']);
    expect(manifest.tables[0]?.inference['c1']).toMatchObject({
      type: 'number',
      numberLocale: 'br',
    });
  });

  it('o token da sessão nunca é gravado no banco, só o hash', async () => {
    const res = await upload(server, 'a.csv', csv('x\n1\n'));
    const { sessionId } = (await res.json()) as ImportBody;
    const stored = await server.db.session.findMany({ select: { id: true } });
    expect(stored.some((s) => s.id === sessionId)).toBe(false);
    expect(stored.every((s) => /^[0-9a-f]{64}$/.test(s.id))).toBe(true);
  });

  it('JSON com inteiros grandes e chaves perigosas', async () => {
    const res = await upload(server, 'dados.json', fixture('json/dangerous-keys.json'));
    expect(res.status).toBe(201);
    const { sessionId } = (await res.json()) as ImportBody;
    const { tables } = await loadDocument(server, sessionId ?? '');
    const t = tables[0] as Table;
    expect(t.columns.map((c) => c.name)).toEqual([
      '__proto__.admin',
      'constructor',
      'prototype',
      'chave.com.ponto',
      'a.b.c',
    ]);
    expect(t.columns[4]?.path).toEqual(['a', 'b.c']);

    const big = await upload(server, 'big.json', fixture('json/bigint.json'));
    const bigDoc = await loadDocument(server, ((await big.json()) as ImportBody).sessionId ?? '');
    expect(rows(bigDoc.tables[0] as Table)[0]).toEqual([
      '12345678901234567890',
      '9007199254740991',
      '9007199254740993',
    ]);
  });

  it('XLSX: pré-visualização no servidor e confirmação com ou sem cabeçalho', async () => {
    const res = await upload(server, 'planilha.xlsx', fixture('xlsx/multi-sheet.xlsx'), {
      path: '/api/import/stage',
    });
    expect(res.status).toBe(200);
    const staged = (await res.json()) as {
      stageId: string;
      preview: { withHeader: Array<{ name: string; columns: string[] }> };
    };
    expect(staged.preview.withHeader.map((p) => p.name)).toEqual(['Clientes', 'Vazia', 'Oculta']);
    expect(staged.preview.withHeader[0]?.columns[0]).toBe('nome');

    const commit = await fetch(`${server.baseUrl}/api/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ stageId: staged.stageId, options: { hasHeader: true } }),
    });
    expect(commit.status).toBe(201);
    const body = (await commit.json()) as ImportBody;
    expect(body.tables.map((t) => [t.name, t.rows])).toEqual([
      ['Clientes', 6],
      ['Vazia', 0],
      ['Oculta', 1],
    ]);

    // A pré-visualização é de uso único.
    const again = await fetch(`${server.baseUrl}/api/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ stageId: staged.stageId, options: { hasHeader: true } }),
    });
    expect(again.status).toBe(410);
  });

  it('abrir outro arquivo substitui o conteúdo da mesma sessão', async () => {
    const first = (await (await upload(server, 'um.csv', csv('a\n1\n'))).json()) as ImportBody;
    const sessionId = first.sessionId ?? '';
    const second = await upload(server, 'dois.csv', csv('b;c\n2;3\n'), { sessionId });
    expect(second.status).toBe(200);
    const body = (await second.json()) as ImportBody;
    expect(body.sessionId).toBeUndefined();
    expect(body.version).toBe(2);
    const { manifest, tables } = await loadDocument(server, sessionId);
    expect(manifest.source.fileName).toBe('dois.csv');
    expect(rows(tables[0] as Table)).toEqual([['2', '3']]);
    // A versão anterior do snapshot desta sessão foi apagada.
    const internalId = hashToken(sessionId);
    expect(
      await server.db.snapshotChunk.count({ where: { sessionId: internalId, version: 1 } }),
    ).toBe(0);
    expect(
      await server.db.snapshotChunk.count({ where: { sessionId: internalId, version: 2 } }),
    ).toBe(1);
  });

  it('opções da pré-visualização são respeitadas', async () => {
    const res = await upload(server, 'x.csv', csv('1;2\n3;4\n'), { options: { hasHeader: false } });
    const { sessionId } = (await res.json()) as ImportBody;
    const { tables } = await loadDocument(server, sessionId ?? '');
    expect(tables[0]?.columns.map((c) => c.name)).toEqual(['coluna_1', 'coluna_2']);
    expect(rows(tables[0] as Table)).toHaveLength(2);
  });
});

describe('validação e erros', () => {
  let server: TestServer;
  beforeAll(async () => {
    server = await startTestServer();
  });
  afterAll(async () => {
    await server.close();
  });

  const expectError = async (res: Response, status: number, code: string, message?: RegExp) => {
    expect(res.status).toBe(status);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe(code);
    if (message) expect(body.error.message).toMatch(message);
    expect(JSON.stringify(body)).not.toMatch(/\.ts:\d+|at \w+ \(/);
  };

  it('extensão não suportada', async () => {
    await expectError(
      await upload(server, 'antigo.xls', csv('x')),
      415,
      'UNSUPPORTED_FORMAT',
      /\.xls/,
    );
    await expectError(await upload(server, 'linhas.jsonl', csv('{}')), 415, 'UNSUPPORTED_FORMAT');
  });

  it('arquivo maior que 20 MB', async () => {
    const big = new Uint8Array(LIMITS.maxFileBytes + 1).fill(0x61);
    await expectError(await upload(server, 'grande.csv', big), 413, 'FILE_TOO_LARGE', /20 MB/);
  });

  it('extensão e conteúdo divergentes', async () => {
    await expectError(
      await upload(server, 'planilha.csv', fixture('xlsx/multi-sheet.xlsx')),
      422,
      'EXTENSION_MISMATCH',
      /extensão \.csv/,
    );
  });

  it('JSON inválido informa linha e coluna', async () => {
    await expectError(
      await upload(server, 'x.json', fixture('invalid/syntax-error.json')),
      422,
      'INVALID_FILE',
      /linha 3, coluna 8/,
    );
  });

  it('zip bomb é recusada', async () => {
    await expectError(
      await upload(server, 'b.xlsx', fixture('invalid/zip-bomb-lying.xlsx'), {
        path: '/api/import/stage',
      }),
      422,
      'ZIP_LIMITS',
    );
  });

  it('limite de colunas', async () => {
    const header = Array.from({ length: LIMITS.maxColumnsPerTable + 1 }, (_, i) => `c${i}`).join(
      ';',
    );
    await expectError(
      await upload(server, 'largo.csv', csv(`${header}\n`)),
      422,
      'LIMIT_EXCEEDED',
      /301 colunas/,
    );
  });

  it('opções malformadas', async () => {
    await expectError(
      await upload(server, 'x.csv', csv('a\n1'), { options: { delimiter: 'x' } }),
      400,
      'BAD_OPTIONS',
    );
  });
});

describe('isolamento e expiração', () => {
  let server: TestServer;
  beforeEach(async () => {
    server = await startTestServer();
  });
  afterEach(async () => {
    await server.close();
  });

  it('a sessão A não acessa os dados da sessão B', async () => {
    const a = (await (await upload(server, 'a.csv', csv('segredo_a\n1\n'))).json()) as ImportBody;
    const b = (await (await upload(server, 'b.csv', csv('segredo_b\n2\n'))).json()) as ImportBody;
    const docA = await loadDocument(server, a.sessionId ?? '');
    const docB = await loadDocument(server, b.sessionId ?? '');
    expect(docA.tables[0]?.columns[0]?.name).toBe('segredo_a');
    expect(docB.tables[0]?.columns[0]?.name).toBe('segredo_b');

    // Sem token, token inventado ou malformado: nada.
    for (const headers of [
      {},
      { 'x-session-id': 'x'.repeat(43) },
      { 'x-session-id': '../../etc' },
    ]) {
      const res = await fetch(`${server.baseUrl}/api/session/chunks/t0/0`, { headers });
      expect(res.status).toBe(410);
    }
  });

  it('sessão expirada responde com mensagem clara, nunca com erro técnico', async () => {
    const { sessionId } = (await (
      await upload(server, 'a.csv', csv('x\n1\n'))
    ).json()) as ImportBody;
    await server.db.session.updateMany({
      data: { lastSeenAt: new Date(Date.now() - 3 * 3_600_000) },
    });
    const res = await fetch(`${server.baseUrl}/api/session/manifest`, {
      headers: { 'x-session-id': sessionId ?? '' },
    });
    expect(res.status).toBe(410);
    const body = (await res.json()) as ErrorBody;
    expect(body.error).toEqual({
      code: 'SESSION_EXPIRED',
      message: 'Sessão expirada. Os dados temporários foram apagados; abra o arquivo novamente.',
    });
  });

  it('fechar o arquivo apaga a sessão e os dados', async () => {
    const { sessionId } = (await (
      await upload(server, 'a.csv', csv('x\n1\n'))
    ).json()) as ImportBody;
    const res = await fetch(`${server.baseUrl}/api/session`, {
      method: 'DELETE',
      headers: { 'x-session-id': sessionId ?? '' },
    });
    expect(res.status).toBe(204);
    expect(await server.db.session.count()).toBe(0);
    expect(await server.db.snapshotChunk.count()).toBe(0);
    expect(await server.db.snapshotManifest.count()).toBe(0);
  });

  it('limite de sessões ativas por IP', async () => {
    for (let i = 0; i < LIMITS.activeSessionsPerIp; i += 1) {
      expect((await upload(server, `s${i}.csv`, csv('x\n1\n'))).status).toBe(201);
    }
    const res = await upload(server, 'mais.csv', csv('x\n1\n'));
    expect(res.status).toBe(429);
    expect(((await res.json()) as ErrorBody).error.code).toBe('SESSION_LIMIT');
  });

  it('limite de importações por hora (substituindo na mesma sessão)', async () => {
    const first = (await (await upload(server, 'a.csv', csv('x\n1\n'))).json()) as ImportBody;
    for (let i = 1; i < LIMITS.importsPerIpPerHour; i += 1) {
      const res = await upload(server, 'a.csv', csv('x\n1\n'), {
        sessionId: first.sessionId ?? '',
      });
      expect(res.status).toBe(200);
    }
    const res = await upload(server, 'a.csv', csv('x\n1\n'), { sessionId: first.sessionId ?? '' });
    expect(res.status).toBe(429);
    expect(((await res.json()) as ErrorBody).error.code).toBe('IMPORT_LIMIT');
  });
});
