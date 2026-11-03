// Tipo nativo depois de uma edição (seção 4.2 e docs/PLANO.md, L5).
// A célula mantém o tipo nativo anterior se o texto novo for compatível com ele. Uma célula sem
// tipo nativo, numa coluna de origem tipada (JSON, XLSX), herda o tipo predominante da coluna.

import { parseDate } from '../infer/date.ts';
import { NATIVE, STATE_VALUE, type NativeCode } from '../model/cell.ts';
import type { ColumnData } from '../model/table.ts';

const JSON_NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

function isJsonText(raw: string): boolean {
  const trimmed = raw.trim();
  if (!(trimmed.startsWith('[') || trimmed.startsWith('{'))) return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

function compatible(native: NativeCode, raw: string): boolean {
  switch (native) {
    case NATIVE.number:
      return JSON_NUMBER.test(raw);
    case NATIVE.boolean:
      return raw === 'true' || raw === 'false';
    case NATIVE.date: {
      const d = parseDate(raw);
      return d !== undefined && d.format !== 'dmy';
    }
    case NATIVE.json:
      return isJsonText(raw);
    case NATIVE.error:
      // O texto de erro do XLSX só se mantém se continuar idêntico a um erro.
      return /^#[A-Z0-9/!?.]+$/.test(raw);
    default:
      return true;
  }
}

/** Tipo nativo mais comum entre as células com tipo nativo da coluna, ou "none". */
export function predominantNative(data: ColumnData, rowIds: readonly number[]): NativeCode {
  const counts = new Map<number, number>();
  for (const rowId of rowIds) {
    if (data.state[rowId] !== STATE_VALUE) continue;
    const t = data.native[rowId] ?? NATIVE.none;
    if (t !== NATIVE.none) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  let best: number = NATIVE.none;
  let bestCount = 0;
  for (const [t, n] of counts) {
    if (n > bestCount) {
      best = t;
      bestCount = n;
    }
  }
  return best as NativeCode;
}

/**
 * @param previous tipo nativo da célula antes da edição
 * @param columnNative tipo nativo predominante da coluna (de predominantNative)
 */
export function nativeAfterEdit(
  previous: NativeCode,
  raw: string,
  columnNative: NativeCode,
): NativeCode {
  const candidate = previous !== NATIVE.none ? previous : columnNative;
  if (candidate === NATIVE.none || candidate === NATIVE.string || candidate === NATIVE.text)
    return candidate;
  if (compatible(candidate, raw)) return candidate;
  // Incompatível: numa origem tipada vira texto; nunca muda o texto para caber no tipo.
  return NATIVE.string;
}
