import crypto from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  STATE_VALUE,
  promoteHeaderRow,
  readCell,
  readCsv,
  readJson,
  type DataDocument,
  type Table,
} from '@datakit/core';
import { xlsxReader } from '../formats/xlsx/xlsxReader.ts';
import { fixture, startTestServer, upload, type TestServer } from '../test/server.ts';

// Checklist de fechamento (seções 12, 13 e 14): o que ainda não tinha teste próprio.

let servers: TestServer[] = [];
afterEach(async () => {
  await Promise.all(servers.map((s) => s.close()));
  servers = [];
});

async function server(options?: Parameters<typeof startTestServer>[0]) {
  const s = await startTestServer(options);
  servers.push(s);
  return s;
}

const bytes = (s: string) => new TextEncoder().encode(s);

async function open(s: TestServer, name: string, content: Uint8Array) {
  const res = await upload(s, name, content, { instanceId: crypto.randomUUID() });
  expect(res.status).toBe(201);
  return ((await res.json()) as { sessionId: string }).sessionId;
}

function exportAs(s: TestServer, sid: string, format: 'csv' | 'xlsx' | 'json', tableIds = ['t0']) {
  const options =
    format === 'csv'
      ? { format, delimiter: ',', header: true, bom: false, formulaGuard: false }
      : format === 'xlsx'
        ? { format, allSheets: tableIds.length > 1, header: true, nativeTypes: true }
        : { format, shape: 'objects', nested: true, indent: true };
  return fetch(`${s.baseUrl}/api/session/export`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-session-id': sid },
    body: JSON.stringify({ expectedSeq: 0, fileName: `x.${format}`, tableIds, options }),
  });
}

describe('segurança', () => {
  it('banco acima do limite: upload recusado com mensagem amigável (seção 12)', async () => {
    const s = await server({ limits: { maxDatabaseBytes: 1 } });
    const res = await upload(s, 'a.csv', bytes('a\n1\n'));
    expect(res.status).toBe(507);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('STORAGE_FULL');
    expect(body.error.message).toContain('sem espaço para novos arquivos');
  });

  it('a exportação só devolve os dados da própria sessão', async () => {
    const s = await server();
    const a = await open(s, 'a.csv', bytes('x\nsegredo-de-A\n'));
    const b = await open(s, 'b.csv', bytes('x\nsegredo-de-B\n'));
    const fromB = await (await exportAs(s, b, 'csv')).text();
    expect(fromB).toContain('segredo-de-B');
    expect(fromB).not.toContain('segredo-de-A');
    expect((await exportAs(s, a, 'csv')).status).toBe(200);
  });

  it('logs sem conteúdo de arquivo e sem ID de sessão completo', async () => {
    const lines: string[] = [];
    const capture = (...args: unknown[]) => {
      lines.push(args.map(String).join(' '));
    };
    const out = vi.spyOn(console, 'log').mockImplementation(capture);
    const err = vi.spyOn(console, 'error').mockImplementation(capture);
    vi.stubEnv('NODE_ENV', 'production');
    try {
      const s = await server();
      const sid = await open(s, 'cpf.csv', bytes('cpf\n123.456.789-00\n'));
      await exportAs(s, sid, 'xlsx');
      await upload(s, 'quebrado.json', bytes('{"conteudo-secreto": '));
      await fetch(`${s.baseUrl}/api/session`, {
        method: 'DELETE',
        headers: { 'x-session-id': sid },
      });
      const all = lines.join('\n');
      expect(all).toContain('importação concluída');
      expect(all).not.toContain('123.456.789-00');
      expect(all).not.toContain('conteudo-secreto');
      expect(all).not.toContain(sid);
      // Nem o hash completo do token (o ID gravado no banco) aparece: só o começo.
      const hashed = crypto.createHash('sha256').update(sid).digest('hex');
      expect(all).not.toContain(hashed);
    } finally {
      vi.unstubAllEnvs();
      out.mockRestore();
      err.mockRestore();
    }
  });
});

describe('desempenho do servidor (seção 13)', () => {
  it('importar 100.000 linhas não trava as outras requisições', async () => {
    const s = await server();
    const big = fixture('large/100k.csv');
    const importing = upload(s, '100k.csv', big, { instanceId: crypto.randomUUID() });
    // Enquanto o worker faz o parsing, o processo principal continua respondendo.
    await new Promise((resolve) => setTimeout(resolve, 300));
    const times: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const t0 = performance.now();
      const res = await fetch(`${s.baseUrl}/api/health`);
      expect(res.status).toBe(200);
      times.push(performance.now() - t0);
    }
    const res = await importing;
    expect(res.status).toBe(201);
    expect(Math.max(...times)).toBeLessThan(500);
  }, 120_000);
});

// --- Ida e volta (seção 14) ----------------------------------------------------------------------

type Matrix = string[][];

/** Cabeçalho + células como texto; `merge` iguala nulo, ausente e vazio (perda da tabela 10.2). */
function matrix(table: Table, withHeader: boolean, merge: boolean): Matrix {
  const rows = table.rowOrder.map((rowId) =>
    table.columns.map((c) => {
      const cell = readCell(table.data.get(c.id) ?? fail(), rowId);
      if (cell.state === STATE_VALUE) return cell.raw;
      return merge ? '' : cell.state === 1 ? '<null>' : '<ausente>';
    }),
  );
  return withHeader ? [table.columns.map((c) => c.name), ...rows] : rows;
}

function fail(): never {
  throw new Error('coluna ausente');
}

async function reread(format: 'csv' | 'xlsx' | 'json', data: Uint8Array): Promise<Matrix> {
  if (format === 'xlsx') {
    const doc = await xlsxReader.read({ bytes: data, fileName: 'x.xlsx', options: {} });
    // O leitor XLSX não aplica cabeçalho: a primeira linha já é o cabeçalho.
    return matrix(doc.tables[0] ?? fail(), false, true);
  }
  const doc: DataDocument =
    format === 'csv'
      ? readCsv({ bytes: data, fileName: 'x.csv', options: { delimiter: ',' } })
      : readJson({ bytes: data, fileName: 'x.json', options: {} });
  return matrix(doc.tables[0] ?? fail(), true, format === 'csv');
}

/** O XLSX não tem linhas vazias no fim nem colunas vazias à direita: completa para comparar. */
function pad(m: Matrix, width: number): Matrix {
  return m.map((r) => [...r, ...Array<string>(Math.max(0, width - r.length)).fill('')]);
}

const SOURCES: Array<{ name: string; data: () => Uint8Array }> = [
  {
    name: 'dados.csv',
    data: () =>
      bytes(
        'cep;valor;preço;texto;vazio\n01310100;10.5;1.234,56;"com ""aspas"", vírgula";\n00012;-7;89,90;  espaços  ;x\n',
      ),
  },
  {
    name: 'dados.json',
    data: () =>
      bytes(
        '[{"id":1,"end":{"cidade":"Rio"},"n":1.25,"ok":true,"cod":"0012"},{"id":2,"end":{"cidade":"São Paulo"},"n":-3,"ok":false,"cod":"7"}]',
      ),
  },
  { name: 'multi.xlsx', data: () => fixture('xlsx/multi-sheet.xlsx') },
];

describe('ida e volta entre todos os formatos', () => {
  for (const source of SOURCES) {
    for (const target of ['csv', 'xlsx', 'json'] as const) {
      it(`${source.name} → ${target} → de novo`, async () => {
        const s = await server();
        const sid = await open(s, source.name, source.data());
        const res = await exportAs(s, sid, target);
        expect(res.status).toBe(200);
        const back = await reread(target, new Uint8Array(await res.arrayBuffer()));

        // O original, como o servidor guardou (mesma leitura do upload).
        let original: Table;
        if (source.name.endsWith('.xlsx')) {
          const doc = await xlsxReader.read({
            bytes: source.data(),
            fileName: 'x.xlsx',
            options: {},
          });
          original = doc.tables[0] ?? fail();
          promoteHeaderRow(original);
        } else {
          const doc = source.name.endsWith('.csv')
            ? readCsv({ bytes: source.data(), fileName: 'x.csv', options: {} })
            : readJson({ bytes: source.data(), fileName: 'x.json', options: {} });
          original = doc.tables[0] ?? fail();
        }
        // JSON → JSON reconstrói os objetos: compara estados exatos. Os outros pares perdem só
        // a diferença entre nulo, ausente e vazio (tabela 10.2).
        const merge = target !== 'json';
        const expected = matrix(original, true, merge);
        const width = expected[0]?.length ?? 0;
        expect(pad(back, width)).toEqual(target === 'xlsx' ? pad(expected, width) : expected);
      }, 60_000);
    }
  }
});
