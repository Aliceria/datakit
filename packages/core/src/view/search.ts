// Busca e substituição (seção 7.4). Opções: diferenciar maiúsculas, ignorar acentos, célula
// inteira. Só procura em células com valor (nulo e ausente não têm texto — L30).
// Para ignorar maiúsculas e acentos, o texto é "dobrado" caractere a caractere, guardando de onde
// veio cada caractere: assim a substituição troca exatamente o trecho certo do texto original.

import { STATE_VALUE } from '../model/cell.ts';
import type { Table } from '../model/table.ts';

export type SearchOptions = {
  query: string;
  caseSensitive: boolean;
  ignoreAccents: boolean;
  wholeCell: boolean;
};

type Folded = { text: string; origin: number[] };

const COMBINING = /\p{M}/gu;

function fold(source: string, opts: SearchOptions): Folded {
  let text = '';
  const origin: number[] = [];
  let i = 0;
  for (const ch of source) {
    let f = ch;
    if (opts.ignoreAccents) f = f.normalize('NFD').replace(COMBINING, '');
    if (!opts.caseSensitive) f = f.toLocaleLowerCase('pt-BR');
    for (let k = 0; k < f.length; k += 1) origin.push(i);
    text += f;
    i += ch.length;
  }
  origin.push(source.length);
  return { text, origin };
}

/** Trechos [início, fim) do texto original que casam com a busca. */
export function matchRanges(raw: string, opts: SearchOptions): Array<[number, number]> {
  if (opts.query === '') return [];
  const needle = fold(opts.query, opts).text;
  if (needle === '') return [];
  const hay = fold(raw, opts);
  if (opts.wholeCell) return hay.text === needle ? [[0, raw.length]] : [];
  const ranges: Array<[number, number]> = [];
  let from = 0;
  for (;;) {
    const at = hay.text.indexOf(needle, from);
    if (at < 0) break;
    const start = hay.origin[at] ?? 0;
    const lastOrigin = hay.origin[at + needle.length - 1] ?? start;
    // Fim = depois do caractere original de onde veio o último caractere dobrado.
    const end = Math.max(start, nextOrigin(hay.origin, lastOrigin, at + needle.length - 1));
    ranges.push([start, end]);
    from = at + needle.length;
  }
  return ranges;
}

function nextOrigin(origin: number[], current: number, index: number): number {
  for (let k = index + 1; k < origin.length; k += 1) {
    const o = origin[k] ?? current;
    if (o !== current) return o;
  }
  return current;
}

/** Transformação da string inteira (rápida, nativa) para só testar se casa. */
function foldWhole(text: string, opts: SearchOptions): string {
  let out = text;
  if (opts.ignoreAccents) out = out.normalize('NFD').replace(COMBINING, '');
  if (!opts.caseSensitive) out = out.toLocaleLowerCase('pt-BR');
  return out;
}

/**
 * Teste rápido (usado em milhões de células). A posição exata dos trechos, só necessária para
 * substituir, fica com matchRanges.
 */
export function createMatcher(opts: SearchOptions): (raw: string) => boolean {
  if (opts.query === '') return () => false;
  const needle = foldWhole(opts.query, opts);
  if (needle === '') return () => false;
  if (opts.wholeCell) return (raw) => foldWhole(raw, opts) === needle;
  if (opts.caseSensitive && !opts.ignoreAccents) return (raw) => raw.includes(needle);
  return (raw) => foldWhole(raw, opts).includes(needle);
}

export function matches(raw: string, opts: SearchOptions): boolean {
  return createMatcher(opts)(raw);
}

/** Texto com cada ocorrência trocada (ou a célula inteira, na opção "célula inteira"). */
export function replaceInText(raw: string, opts: SearchOptions, replacement: string): string {
  const ranges = matchRanges(raw, opts);
  let out = raw;
  for (const [start, end] of [...ranges].reverse()) {
    out = out.slice(0, start) + replacement + out.slice(end);
  }
  return out;
}

export type SearchHit = { rowId: number; colId: string };

/** Células que casam, na ordem de leitura (linha a linha, coluna a coluna). */
export function findMatches(
  table: Table,
  rowIds: readonly number[],
  colIds: readonly string[],
  opts: SearchOptions,
  limit = Number.POSITIVE_INFINITY,
): SearchHit[] {
  const hits: SearchHit[] = [];
  if (opts.query === '') return hits;
  const test = createMatcher(opts);
  const columns = colIds.map((id) => [id, table.data.get(id)] as const);
  for (const rowId of rowIds) {
    for (const [colId, data] of columns) {
      if (!data || data.state[rowId] !== STATE_VALUE) continue;
      if (test(data.raw[rowId] ?? '')) {
        hits.push({ rowId, colId });
        if (hits.length >= limit) return hits;
      }
    }
  }
  return hits;
}
