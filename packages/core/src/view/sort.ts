// Ordenação da visualização (seção 7.4): números numericamente (exato), datas cronologicamente,
// texto com o comparador do idioma; vazios, nulos e ausentes sempre no fim, nas duas direções.
// Na coluna de tipo definido, os valores do tipo vêm primeiro e os inconsistentes depois (L29).
// O comparador de texto vem de fora (Intl.Collator('pt-BR') no navegador): o resultado depende da
// versão do ICU do motor, por isso só é usado para visualizar; a ordem gravada vai resolvida.

import type { ColumnInference } from '../infer/classify.ts';
import { STATE_ABSENT, STATE_NULL } from '../model/cell.ts';
import type { Table } from '../model/table.ts';
import { compareDecimal, type Decimal } from '../util/decimal.ts';
import { TEXT_INFERENCE, cellFacts } from './facts.ts';

export type SortDirection = 'asc' | 'desc';
export type SortKey = { colId: string; direction: SortDirection };

export type TextCompare = (a: string, b: string) => number;

/** Grupo de ordenação: só os grupos 0 e 1 seguem a direção; os demais ficam sempre no fim. */
const VALUE = 0;
const OTHER = 1;
const BLANK = 2;
const NULL = 3;
const ABSENT = 4;

type Key = {
  group: number;
  kind: 'number' | 'date' | 'boolean' | 'text';
  d?: Decimal;
  n?: number;
  s: string;
};

function keyFor(table: Table, colId: string, info: ColumnInference, rowId: number): Key {
  const data = table.data.get(colId);
  if (!data) return { group: ABSENT, kind: 'text', s: '' };
  const facts = cellFacts(data, rowId, info);
  if (facts.state === STATE_NULL) return { group: NULL, kind: 'text', s: '' };
  if (facts.state === STATE_ABSENT) return { group: ABSENT, kind: 'text', s: '' };
  if (facts.value.kind === 'empty') return { group: BLANK, kind: 'text', s: '' };

  const predominant = info.type !== 'mixed' && facts.value.kind === info.type;
  if (predominant && facts.decimal)
    return { group: VALUE, kind: 'number', d: facts.decimal, s: facts.raw };
  if (predominant && facts.dateKey !== undefined) {
    return { group: VALUE, kind: 'date', n: facts.dateKey, s: facts.raw };
  }
  if (predominant && facts.value.kind === 'boolean') {
    return {
      group: VALUE,
      kind: 'boolean',
      n: facts.raw.toLowerCase() === 'true' ? 1 : 0,
      s: facts.raw,
    };
  }
  // Texto, JSON, coluna mista ou valor inconsistente: compara como texto.
  return {
    group: predominant || info.type === 'mixed' ? VALUE : OTHER,
    kind: 'text',
    s: facts.raw,
  };
}

function compareKeys(a: Key, b: Key, direction: SortDirection, text: TextCompare): number {
  if (a.group !== b.group) return a.group - b.group;
  if (a.group >= BLANK) return 0;
  let cmp: number;
  if (a.kind === 'number' && b.kind === 'number' && a.d && b.d) cmp = compareDecimal(a.d, b.d);
  else if ((a.kind === 'date' || a.kind === 'boolean') && a.kind === b.kind)
    cmp = (a.n ?? 0) - (b.n ?? 0);
  else cmp = text(a.s, b.s);
  return direction === 'asc' ? cmp : -cmp;
}

/** Ordena (de forma estável) as linhas dadas pelos critérios, em ordem de prioridade. */
export function sortRows(
  table: Table,
  rowIds: readonly number[],
  keys: readonly SortKey[],
  inference: Record<string, ColumnInference>,
  text: TextCompare,
): number[] {
  const active = keys.filter((k) => table.data.has(k.colId));
  if (active.length === 0) return [...rowIds];
  const columns = active.map((k) => {
    const info = inference[k.colId] ?? TEXT_INFERENCE;
    const map = new Map<number, Key>();
    for (const rowId of rowIds) map.set(rowId, keyFor(table, k.colId, info, rowId));
    return { map, direction: k.direction };
  });
  const position = new Map(rowIds.map((id, i) => [id, i]));
  return [...rowIds].sort((x, y) => {
    for (const col of columns) {
      const a = col.map.get(x);
      const b = col.map.get(y);
      if (a && b) {
        const cmp = compareKeys(a, b, col.direction, text);
        if (cmp !== 0) return cmp;
      }
    }
    return (position.get(x) ?? 0) - (position.get(y) ?? 0);
  });
}
