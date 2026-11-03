// Formato do snapshot e do transporte (docs/PLANO.md, seção 4.3).
// O documento é dividido em blocos de linhas (pelo ID da linha) e um manifesto.
// Este módulo só converte para objetos JSON; a compactação (gzip) fica com quem grava ou transmite.

import { inferColumn, type ColumnInference } from '../infer/classify.ts';
import {
  STATE_ABSENT,
  STATE_NULL,
  STATE_VALUE,
  type CellExtras,
  type CellState,
} from '../model/cell.ts';
import type { DataDocument, ImportWarning, SourceInfo } from '../model/document.ts';
import { createColumnData, type Column, type Table } from '../model/table.ts';
import { computeTableStats, type TableStats } from '../stats/tableStats.ts';

export const SNAPSHOT_FORMAT_VERSION = 1;
export const CHUNK_ROWS = 4096;

export type TableManifest = {
  id: string;
  name: string;
  hidden: boolean;
  columns: Column[];
  rowOrder: number[];
  nextRowId: number;
  nextColId: number;
  /** Índices dos blocos que existem (bloco = floor(rowId / CHUNK_ROWS)). */
  chunks: number[];
  stats: TableStats;
  inference: Record<string, ColumnInference>;
};

export type DocumentManifest = {
  formatVersion: typeof SNAPSHOT_FORMAT_VERSION;
  source: SourceInfo;
  warnings: ImportWarning[];
  tables: TableManifest[];
};

export type ChunkColumn = {
  /** Um caractere por linha: v = valor, n = nulo, a = ausente. */
  s: string;
  /** Texto de cada linha; null quando não é valor. */
  r: (string | null)[];
  /** Um dígito por linha: tipo nativo. */
  t: string;
  x?: Record<string, CellExtras>;
};

export type ChunkPayload = {
  rowIds: number[];
  cols: Record<string, ChunkColumn>;
};

export type EncodedChunk = { tableId: string; index: number; payload: ChunkPayload };

const STATE_CHAR = ['v', 'n', 'a'] as const;
const CHAR_STATE: Record<string, CellState> = { v: STATE_VALUE, n: STATE_NULL, a: STATE_ABSENT };

export function encodeDocument(doc: DataDocument): {
  manifest: DocumentManifest;
  chunks: EncodedChunk[];
} {
  const chunks: EncodedChunk[] = [];
  const tables = doc.tables.map((table): TableManifest => {
    const byChunk = new Map<number, number[]>();
    for (const rowId of table.rowOrder) {
      const index = Math.floor(rowId / CHUNK_ROWS);
      const list = byChunk.get(index);
      if (list) list.push(rowId);
      else byChunk.set(index, [rowId]);
    }
    const indexes = [...byChunk.keys()].sort((a, b) => a - b);
    for (const index of indexes) {
      const rowIds = (byChunk.get(index) ?? []).sort((a, b) => a - b);
      const cols: Record<string, ChunkColumn> = {};
      for (const column of table.columns) {
        const data = table.data.get(column.id);
        if (!data) continue;
        let s = '';
        let t = '';
        const r: (string | null)[] = [];
        const x: Record<string, CellExtras> = {};
        rowIds.forEach((rowId, i) => {
          const state = (data.state[rowId] ?? STATE_VALUE) as CellState;
          s += STATE_CHAR[state];
          t += String(data.native[rowId] ?? 0);
          r.push(state === STATE_VALUE ? (data.raw[rowId] ?? '') : null);
          const extras = data.extras.get(rowId);
          if (extras) x[String(i)] = extras;
        });
        cols[column.id] = Object.keys(x).length > 0 ? { s, r, t, x } : { s, r, t };
      }
      chunks.push({ tableId: table.id, index, payload: { rowIds, cols } });
    }

    const inference: Record<string, ColumnInference> = {};
    for (const column of table.columns) {
      const data = table.data.get(column.id);
      if (data) inference[column.id] = inferColumn(data, table.rowOrder);
    }

    return {
      id: table.id,
      name: table.name,
      hidden: table.hidden,
      columns: table.columns,
      rowOrder: table.rowOrder,
      nextRowId: table.nextRowId,
      nextColId: table.nextColId,
      chunks: indexes,
      stats: computeTableStats(table),
      inference,
    };
  });

  return {
    manifest: {
      formatVersion: SNAPSHOT_FORMAT_VERSION,
      source: doc.source,
      warnings: doc.warnings,
      tables,
    },
    chunks,
  };
}

/** Cria a tabela vazia a partir do manifesto; os blocos são aplicados depois com applyChunk. */
export function tableFromManifest(m: TableManifest): Table {
  const data = new Map(m.columns.map((c) => [c.id, createColumnData(m.nextRowId, STATE_ABSENT)]));
  return {
    id: m.id,
    name: m.name,
    hidden: m.hidden,
    columns: m.columns,
    data,
    rowOrder: m.rowOrder,
    nextRowId: m.nextRowId,
    nextColId: m.nextColId,
  };
}

export function applyChunk(table: Table, payload: ChunkPayload): void {
  for (const [columnId, col] of Object.entries(payload.cols)) {
    const data = table.data.get(columnId);
    if (!data) throw new Error(`Bloco com coluna desconhecida: ${columnId}`);
    payload.rowIds.forEach((rowId, i) => {
      const state = CHAR_STATE[col.s[i] ?? 'v'] ?? STATE_VALUE;
      data.state[rowId] = state;
      data.raw[rowId] = state === STATE_VALUE ? (col.r[i] ?? '') : undefined;
      data.native[rowId] = Number(col.t[i] ?? '0');
      const extras = col.x?.[String(i)];
      if (extras) data.extras.set(rowId, extras);
    });
  }
}
