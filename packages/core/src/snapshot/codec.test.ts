import { describe, expect, it } from 'vitest';
import { readJson } from '../formats/json/jsonReader.ts';
import { readCell, type Table } from '../model/table.ts';
import { applyChunk, CHUNK_ROWS, encodeDocument, tableFromManifest } from './codec.ts';

const utf8 = (s: string) => new TextEncoder().encode(s);

function dump(table: Table) {
  return table.rowOrder.map((rowId) =>
    table.columns.map((c) => {
      const data = table.data.get(c.id);
      return data ? readCell(data, rowId) : undefined;
    }),
  );
}

describe('snapshot', () => {
  it('ida e volta preserva estado, texto, tipo nativo e ordem', () => {
    const rows = Array.from({ length: CHUNK_ROWS + 10 }, (_, i) =>
      i % 3 === 0 ? { a: i, b: null } : { a: String(i).padStart(5, '0'), c: '  ' },
    );
    const doc = readJson({ bytes: utf8(JSON.stringify(rows)), fileName: 'x.json', options: {} });
    const { manifest, chunks } = encodeDocument(doc);
    const tm = manifest.tables[0];
    if (!tm) throw new Error('sem tabela');
    expect(tm.chunks).toEqual([0, 1]);

    // Passa pelo JSON, como no transporte real.
    const restored = tableFromManifest(JSON.parse(JSON.stringify(tm)) as typeof tm);
    for (const chunk of chunks) {
      applyChunk(restored, JSON.parse(JSON.stringify(chunk.payload)) as typeof chunk.payload);
    }
    expect(dump(restored)).toEqual(dump(doc.tables[0] as Table));
  });

  it('manifesto traz estatísticas e inferência', () => {
    const doc = readJson({
      bytes: utf8('[{"v":"1,5"},{"v":"2,5"},{"v":"2,5"},{"v":null}]'),
      fileName: 'x.json',
      options: {},
    });
    const tm = encodeDocument(doc).manifest.tables[0];
    expect(tm?.stats).toMatchObject({ rows: 4, columns: 1, nullCells: 1, duplicateRows: 1 });
    expect(tm?.inference['c0']?.type).toBe('number');
  });
});
