// Tipos e estados na saída (seções 10.1 e 10.2). Nada aqui passa número por `Number` para
// gravar: o texto canônico vai direto para o arquivo (docs/PLANO.md, regra 4).

import { parseDate, type DateParts } from '../infer/date.ts';
import { NATIVE, STATE_ABSENT, STATE_NULL, STATE_VALUE } from '../model/cell.ts';
import type { ColumnData } from '../model/table.ts';

export type ExportFormat = 'csv' | 'xlsx' | 'json';

/** Valor de saída de uma célula, já decidido o tipo. */
export type OutValue =
  | { kind: 'absent' }
  | { kind: 'null' }
  | { kind: 'empty' }
  | { kind: 'string'; text: string }
  /** Texto canônico do número: sem zero à esquerda, ponto decimal, sem milhar. */
  | { kind: 'number'; text: string }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'date'; parts: DateParts; withTime: boolean }
  /** Objeto ou lista JSON, em texto JSON válido. */
  | { kind: 'json'; text: string };

/** Número canônico (seção 10.1): sem zero à esquerda, ponto decimal, sem separador de milhar. */
const CANONICAL = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
/** Número JSON (com expoente), como o JSON de origem guarda. */
const JSON_NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

/** Dígitos significativos de um número canônico (o XLSX guarda até 15 sem perda). */
export function significantDigits(text: string): number {
  const digits = text
    .replace(/^-/, '')
    .replace(/[eE].*$/, '')
    .replace('.', '');
  const trimmed = digits.replace(/^0+/, '');
  // Zeros à direita depois da vírgula não contam ("1.50" = 1.5); na parte inteira, contam.
  const significant = text.includes('.') ? trimmed.replace(/0+$/, '') : trimmed;
  return Math.max(1, significant.length);
}

export type OutContext = {
  format: ExportFormat;
  /** Contadores de perdas, para os avisos. */
  stats: OutStats;
};

export type OutStats = {
  /** Números que saíram como texto no XLSX por passarem de 15 dígitos significativos. */
  longNumbers: number;
};

function asNumber(text: string, ctx: OutContext): OutValue {
  if (ctx.format === 'xlsx' && significantDigits(text) > 15) {
    ctx.stats.longNumbers += 1;
    return { kind: 'string', text };
  }
  return { kind: 'number', text };
}

/** Decide o valor de saída de uma célula para o formato de destino. */
export function outputValue(data: ColumnData, rowId: number, ctx: OutContext): OutValue {
  const state = data.state[rowId] ?? STATE_VALUE;
  if (state === STATE_ABSENT) return { kind: 'absent' };
  if (state === STATE_NULL) return { kind: 'null' };
  const raw = data.raw[rowId] ?? '';
  if (raw === '') return { kind: 'empty' };
  const native = data.native[rowId] ?? NATIVE.none;
  switch (native) {
    case NATIVE.number: {
      // XLSX e JSON de origem: número; o texto é o original (JSON) ou canônico (XLSX).
      const text = raw.trim();
      return JSON_NUMBER.test(text) ? asNumber(text, ctx) : { kind: 'string', text: raw };
    }
    case NATIVE.boolean: {
      const word = raw.trim().toLowerCase();
      if (word === 'true' || word === 'false') return { kind: 'boolean', value: word === 'true' };
      return { kind: 'string', text: raw };
    }
    case NATIVE.date: {
      const parsed = parseDate(raw.trim());
      if (parsed && parsed.format !== 'dmy') {
        const { hour, minute, second } = parsed.parts;
        return {
          kind: 'date',
          parts: parsed.parts,
          withTime: parsed.format === 'iso' || hour + minute + second > 0,
        };
      }
      return { kind: 'string', text: raw };
    }
    case NATIVE.json:
      return { kind: 'json', text: raw };
    case NATIVE.string:
    case NATIVE.text:
    case NATIVE.error:
      return { kind: 'string', text: raw };
    default:
      // Sem tipo de origem (CSV, digitado): número só se for canônico (seção 10.1).
      return CANONICAL.test(raw) ? asNumber(raw, ctx) : { kind: 'string', text: raw };
  }
}

// --- Proteção contra fórmulas (seção 12) ---------------------------------------------------------

const FORMULA_START = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^[+-]?(?:\d+(?:[.,]\d+)*|\d*[.,]\d+)(?:[eE][+-]?\d+)?$/;

/** Texto que uma planilha leria como fórmula: recebe um `'` na frente. Números (`-5`) não. */
export function needsFormulaGuard(text: string): boolean {
  return FORMULA_START.test(text) && !PLAIN_NUMBER.test(text.trim());
}

export function guardFormula(text: string): string {
  return needsFormulaGuard(text) ? `'${text}` : text;
}
