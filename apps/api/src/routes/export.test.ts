import crypto from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { readCell, type LogOp } from '@datakit/core';
import { xlsxReader } from '../formats/xlsx/xlsxReader.ts';
import { startTestServer, upload, fixture, type TestServer } from '../test/server.ts';
import { contentDisposition } from './export.ts';

let server: TestServer;
afterEach(async () => {
  await server.close();
});

const bytes = (s: string) => new TextEncoder().encode(s);

async function open(name: string, content: Uint8Array) {
  server = await startTestServer();
  const instanceId = crypto.randomUUID();
  const res = await upload(server, name, content, { instanceId });
  const { sessionId } = (await res.json()) as { sessionId: string };
  return { sid: sessionId, instanceId };
}

function exportFile(sid: string, body: Record<string, unknown>) {
  return fetch(`${server.baseUrl}/api/session/export`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-session-id': sid },
    body: JSON.stringify({ expectedSeq: 0, fileName: 'saída.csv', tableIds: ['t0'], ...body }),
  });
}

const CSV = { format: 'csv', delimiter: ';', header: true, bom: true, formulaGuard: true };

describe('POST /api/session/export', () => {
  it('CSV com BOM, proteção contra fórmula e nome com acento no cabeçalho', async () => {
    const { sid } = await open('d.csv', bytes('nome;f\nJoão;=1+1\n'));
    const res = await exportFile(sid, { options: CSV });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(res.headers.get('content-disposition')).toBe(
      `attachment; filename="saida.csv"; filename*=UTF-8''sa%C3%ADda.csv`,
    );
    // res.text() tiraria o BOM ao decodificar: confere os bytes.
    const raw = Buffer.from(await res.arrayBuffer());
    expect([...raw.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(raw.subarray(3).toString('utf8')).toBe("nome;f\r\nJoão;'=1+1\r\n");
  });

  it('só exporta quando todas as operações chegaram (NOT_SYNCED)', async () => {
    const { sid, instanceId } = await open('d.csv', bytes('a;b\n1;2\n'));
    const op: LogOp = {
      seq: 1,
      opId: crypto.randomUUID(),
      kind: 'edit',
      label: 'Editar',
      effect: {
        type: 'setCells',
        tableId: 't0',
        cells: [{ rowId: 0, colId: 'c0', value: { s: 0, r: 'novo', t: 0 } }],
      },
    };
    await fetch(`${server.baseUrl}/api/session/ops`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-session-id': sid },
      body: JSON.stringify({ instanceId, ops: [op] }),
    });
    const stale = await exportFile(sid, { options: CSV });
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as { error: { code: string } }).error.code).toBe('NOT_SYNCED');
    const ok = await exportFile(sid, { expectedSeq: 1, options: { ...CSV, bom: false } });
    expect(await ok.text()).toBe('a;b\r\nnovo;2\r\n');

    // Depois da exportação completa, o navegador manda a operação que limpa as marcas (L19).
    const exported = await fetch(`${server.baseUrl}/api/session/ops`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-session-id': sid },
      body: JSON.stringify({
        instanceId,
        ops: [{ seq: 2, opId: crypto.randomUUID(), kind: 'exported', tableIds: ['t0'] }],
      }),
    });
    expect(exported.status).toBe(200);
    expect(((await exported.json()) as { ackedSeq: number }).ackedSeq).toBe(2);
  });

  it('linhas visíveis na ordem pedida; linha inexistente é recusada', async () => {
    const { sid } = await open('d.csv', bytes('a;b\n1;2\n3;4\n5;6\n'));
    const res = await exportFile(sid, { rowIds: [2, 0], options: { ...CSV, bom: false } });
    expect(await res.text()).toBe('a;b\r\n5;6\r\n1;2\r\n');
    const bad = await exportFile(sid, { rowIds: [99], options: CSV });
    expect(bad.status).toBe(500);
  });

  it('JSON de JSON aninhado volta igual', async () => {
    const source = '[{"id":1,"e":{"c":"Rio"},"n":12345678901234567890},{"id":2,"x":null}]';
    const { sid } = await open('d.json', bytes(source));
    const res = await exportFile(sid, {
      fileName: 'd.json',
      options: { format: 'json', shape: 'objects', nested: true, indent: false },
    });
    expect(await res.text()).toBe(`${source}\n`);
  });

  it('XLSX: ida e volta com tipos, texto com "=" nunca vira fórmula, aba oculta continua oculta', async () => {
    const { sid } = await open(
      'd.csv',
      bytes('cod;valor;f;longo\n0012;10.5;=SOMA(A1);12345678901234567890\n'),
    );
    const res = await exportFile(sid, {
      fileName: 'd.xlsx',
      options: { format: 'xlsx', allSheets: false, header: true, nativeTypes: true },
    });
    expect(res.status).toBe(200);
    const doc = await xlsxReader.read({
      bytes: new Uint8Array(await res.arrayBuffer()),
      fileName: 'd.xlsx',
      options: {},
    });
    const table = doc.tables[0];
    if (!table) throw new Error('sem tabela');
    const row = table.rowOrder[1] ?? -1;
    const values = table.columns.map((c) => {
      const data = table.data.get(c.id);
      if (!data) throw new Error('coluna');
      return readCell(data, row);
    });
    expect(values.map((v) => v.raw)).toEqual(['0012', '10.5', '=SOMA(A1)', '12345678901234567890']);
    // 0012 texto, 10.5 número, fórmula como texto, número longo como texto.
    expect(values.map((v) => v.native)).toEqual([1, 2, 1, 1]);
    expect(values[2]?.extras?.formula).toBeUndefined();

    const multi = await open('m.xlsx', fixture('xlsx/multi-sheet.xlsx'));
    const res2 = await exportFile(multi.sid, {
      fileName: 'm.xlsx',
      tableIds: ['t0', 't1', 't2'],
      options: { format: 'xlsx', allSheets: true, header: true, nativeTypes: true },
    });
    expect(res2.status).toBe(200);
    const back = await xlsxReader.read({
      bytes: new Uint8Array(await res2.arrayBuffer()),
      fileName: 'm.xlsx',
      options: {},
    });
    expect(back.tables.map((t) => t.hidden)).toContain(true);
  });

  it('pedido inválido e sessão de outra pessoa', async () => {
    const { sid } = await open('d.csv', bytes('a\n1\n'));
    expect((await exportFile(sid, { options: { format: 'pdf' } })).status).toBe(400);
    expect((await exportFile('x'.repeat(43), { options: CSV })).status).toBe(410);
  });
});

describe('Content-Disposition', () => {
  it('remove caminho e controle; aspas e acentos seguros', () => {
    expect(contentDisposition('../a"b;c.csv')).toBe(
      `attachment; filename=".._a_b_c.csv"; filename*=UTF-8''.._a%22b%3Bc.csv`,
    );
  });
});
