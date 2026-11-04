// Ferramentas de tratamento de dados (seção 8). Cada uma devolve um efeito resolvido, que conta
// como uma operação só no histórico e pode ser desfeita. Rodam no navegador; o servidor recebe
// o efeito pronto. Só mexem nas linhas e colunas recebidas (escopo da seção 7.5).

import { formatIsoDate, parseDate } from '../infer/date.ts';
import { toCanonicalNumber } from '../infer/number.ts';
import { NATIVE, STATE_VALUE, type NativeCode } from '../model/cell.ts';
import type { Table } from '../model/table.ts';
import { readValue, type CellChange, type Effect } from './effects.ts';
import { planSetTexts, type CellRef } from './planners.ts';

const BLANK = (state: number | undefined, raw: string | undefined, whitespace: boolean) =>
  state !== STATE_VALUE || raw === undefined || raw === '' || (whitespace && raw.trim() === '');

// --- Remover duplicadas ------------------------------------------------------------------------

export type DuplicateOptions = { ignoreCase: boolean; trim: boolean };

/**
 * Linhas repetidas, na ordem recebida: a primeira ocorrência fica, as seguintes são devolvidas.
 * Compara estado, tipo nativo e texto das colunas escolhidas.
 */
export function findDuplicateRows(
  table: Table,
  rowIds: readonly number[],
  colIds: readonly string[],
  options: DuplicateOptions,
): number[] {
  const steps = findDuplicateRowsInSlices(table, rowIds, colIds, options, Infinity);
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
  }
}

/**
 * O mesmo, em fatias: o gerador pausa a cada `sliceRows` linhas, para o navegador devolver o
 * controle à interface entre uma fatia e outra (100.000 linhas × 20 colunas levam ~0,6 s).
 */
export function* findDuplicateRowsInSlices(
  table: Table,
  rowIds: readonly number[],
  colIds: readonly string[],
  options: DuplicateOptions,
  sliceRows = 5000,
): Generator<void, number[], void> {
  const columns = colIds.map((id) => table.data.get(id)).filter((d) => d !== undefined);
  const seen = new Set<string>();
  const duplicates: number[] = [];
  let inSlice = 0;
  for (const rowId of rowIds) {
    if (++inSlice > sliceRows) {
      inSlice = 1;
      yield;
    }
    let key = '';
    for (const data of columns) {
      const state = data.state[rowId] ?? STATE_VALUE;
      let raw = state === STATE_VALUE ? (data.raw[rowId] ?? '') : '';
      if (options.trim) raw = raw.trim();
      if (options.ignoreCase) raw = raw.toLocaleLowerCase('pt-BR');
      // Com as opções de comparação, o tipo nativo não diferencia ("1" texto e 1 número).
      const native = options.trim || options.ignoreCase ? 0 : (data.native[rowId] ?? 0);
      key += `${String(state)}\u0001${String(native)}\u0001${String(raw.length)}\u0001${raw}\u0002`;
    }
    if (seen.has(key)) duplicates.push(rowId);
    else seen.add(key);
  }
  return duplicates;
}

// --- Linhas vazias -----------------------------------------------------------------------------

/** Linhas em que todas as células estão vazias, nulas ou ausentes. */
export function findEmptyRows(
  table: Table,
  rowIds: readonly number[],
  options: { whitespaceAsEmpty: boolean },
): number[] {
  const columns = table.columns.map((c) => table.data.get(c.id)).filter((d) => d !== undefined);
  return rowIds.filter((rowId) =>
    columns.every((data) => BLANK(data.state[rowId], data.raw[rowId], options.whitespaceAsEmpty)),
  );
}

// --- Converter tipo ----------------------------------------------------------------------------

export type ConvertTarget = 'text' | 'number' | 'date' | 'boolean';
export type ConvertSource = {
  numberLocale: 'br' | 'intl';
  dateFormat: 'dmy' | 'ymd';
};

export type ConvertPlan = {
  effect: Effect;
  /** Células que mudam. */
  converted: number;
  /** Células com valor que não puderam ser convertidas (ficam como estão). */
  failed: number[];
};

const TRUE_WORDS = new Set(['true', 'verdadeiro', 'sim', 's', 'yes', '1']);
const FALSE_WORDS = new Set(['false', 'falso', 'não', 'nao', 'n', 'no', '0']);

/** Inteiro com zeros à esquerda (só vale na conversão explícita para número). */
const LEADING_ZEROS = /^([+-]?)0+(\d.*)$/;

function canonicalNumber(
  raw: string,
  native: NativeCode,
  source: ConvertSource,
): string | undefined {
  const text = raw.trim();
  if (native === NATIVE.number) return text;
  const direct = toCanonicalNumber(text, source.numberLocale);
  if (direct !== undefined) return direct;
  // "00123" é código para a inferência, mas o usuário pediu número: tira os zeros à esquerda.
  const m = LEADING_ZEROS.exec(text);
  if (m) {
    const canonical = toCanonicalNumber(`${m[1] ?? ''}${m[2] ?? ''}`, source.numberLocale);
    if (canonical !== undefined) return canonical;
  }
  return undefined;
}

function canonicalDate(raw: string, source: ConvertSource): string | undefined {
  const text = raw.trim();
  const parsed = parseDate(text);
  if (!parsed) return undefined;
  // dd/mm/aaaa só quando a origem é essa; aaaa-mm-dd e ISO valem nos dois casos.
  if (parsed.format === 'dmy' && source.dateFormat !== 'dmy') return undefined;
  const { hour, minute, second } = parsed.parts;
  const withTime = parsed.format === 'iso' || hour + minute + second > 0 || /\d:\d/.test(text);
  return formatIsoDate(parsed.parts, withTime);
}

function canonicalBoolean(raw: string): string | undefined {
  const word = raw.trim().toLocaleLowerCase('pt-BR');
  if (TRUE_WORDS.has(word)) return 'true';
  if (FALSE_WORDS.has(word)) return 'false';
  return undefined;
}

/**
 * Converte a coluna para o tipo pedido, gravando a forma canônica (seção 8):
 * número `1234.56`, data `aaaa-mm-dd` (com hora: `aaaa-mm-ddThh:mm:ss`), booleano `true`/`false`.
 * Vazios, nulos e ausentes ficam como estão; o que não converte também, e é devolvido em `failed`.
 */
export function planConvertType(
  table: Table,
  colId: string,
  rowIds: readonly number[],
  target: ConvertTarget,
  source: ConvertSource,
): ConvertPlan {
  const data = table.data.get(colId);
  if (!data) throw new Error(`Coluna inexistente: ${colId}`);
  const cells: CellChange[] = [];
  const failed: number[] = [];
  for (const rowId of rowIds) {
    if (BLANK(data.state[rowId], data.raw[rowId], true)) continue;
    const current = readValue(data, rowId);
    const raw = current.r ?? '';
    let next: string | undefined;
    let native: NativeCode;
    switch (target) {
      case 'text':
        next = raw;
        native = NATIVE.text;
        break;
      case 'number':
        next = canonicalNumber(raw, current.t, source);
        native = NATIVE.number;
        break;
      case 'date':
        next = canonicalDate(raw, source);
        native = NATIVE.date;
        break;
      case 'boolean':
        next = current.t === NATIVE.boolean ? raw.trim() : canonicalBoolean(raw);
        native = NATIVE.boolean;
        break;
    }
    if (next === undefined) {
      failed.push(rowId);
      continue;
    }
    if (next === raw && native === current.t) continue;
    const value = { ...current, r: next, t: native };
    cells.push({ rowId, colId, value });
  }
  return {
    effect: { type: 'setCells', tableId: table.id, cells },
    converted: cells.length,
    failed,
  };
}

// --- Operações em colunas selecionadas --------------------------------------------------------

export type TextTransform = 'trim' | 'upper' | 'lower' | 'title';

/** Primeira Letra Maiúscula de cada palavra; o resto em minúsculas. */
function titleCase(text: string): string {
  return text
    .toLocaleLowerCase('pt-BR')
    .replace(
      /(^|[\s\-/("'])(\p{L})/gu,
      (_, sep: string, letter: string) => `${sep}${letter.toLocaleUpperCase('pt-BR')}`,
    );
}

export function transformText(text: string, kind: TextTransform): string {
  switch (kind) {
    case 'trim':
      return text.trim();
    case 'upper':
      return text.toLocaleUpperCase('pt-BR');
    case 'lower':
      return text.toLocaleLowerCase('pt-BR');
    case 'title':
      return titleCase(text);
  }
}

export type ToolPlan = { effect: Effect; cells: number };

function cellsOf(table: Table, colIds: readonly string[], rowIds: readonly number[]) {
  const out: Array<{ ref: CellRef; state: number; raw: string }> = [];
  for (const colId of colIds) {
    const data = table.data.get(colId);
    if (!data) continue;
    for (const rowId of rowIds) {
      const state = data.state[rowId] ?? STATE_VALUE;
      out.push({ ref: { rowId, colId }, state, raw: data.raw[rowId] ?? '' });
    }
  }
  return out;
}

/** Aparar espaços e mudar maiúsculas: só nas células com texto que realmente muda. */
export function planTransform(
  table: Table,
  colIds: readonly string[],
  rowIds: readonly number[],
  kind: TextTransform,
): ToolPlan {
  const items = cellsOf(table, colIds, rowIds)
    .filter((c) => c.state === STATE_VALUE)
    .map((c) => ({ ...c.ref, raw: transformText(c.raw, kind), old: c.raw }))
    .filter((c) => c.raw !== c.old)
    .map(({ rowId, colId, raw }) => ({ rowId, colId, raw }));
  return { effect: planSetTexts(table, items), cells: items.length };
}

/** Preencher vazios (texto vazio, só espaços, nulo ou ausente) com um valor. */
export function planFillEmpty(
  table: Table,
  colIds: readonly string[],
  rowIds: readonly number[],
  value: string,
): ToolPlan {
  const items = cellsOf(table, colIds, rowIds)
    .filter((c) => BLANK(c.state, c.raw, true))
    .map((c) => ({ ...c.ref, raw: value }));
  return { effect: planSetTexts(table, items), cells: items.length };
}

/** Substituir valor: células cujo texto inteiro é igual a `from` passam a ser `to`. */
export function planReplaceValue(
  table: Table,
  colIds: readonly string[],
  rowIds: readonly number[],
  from: string,
  to: string,
): ToolPlan {
  const items = cellsOf(table, colIds, rowIds)
    .filter((c) => c.state === STATE_VALUE && c.raw === from && from !== to)
    .map((c) => ({ ...c.ref, raw: to }));
  return { effect: planSetTexts(table, items), cells: items.length };
}

/** Limpar coluna: todas as células viram texto vazio (as que já são ficam de fora). */
export function planClearColumns(
  table: Table,
  colIds: readonly string[],
  rowIds: readonly number[],
): ToolPlan {
  const items = cellsOf(table, colIds, rowIds)
    .filter((c) => !(c.state === STATE_VALUE && c.raw === ''))
    .map((c) => ({ ...c.ref, raw: '' }));
  return { effect: planSetTexts(table, items), cells: items.length };
}
