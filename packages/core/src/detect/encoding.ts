import type { TextEncoding } from '../model/document.ts';

const BOM = [0xef, 0xbb, 0xbf] as const;

export function hasUtf8Bom(bytes: Uint8Array): boolean {
  return bytes[0] === BOM[0] && bytes[1] === BOM[1] && bytes[2] === BOM[2];
}

/**
 * UTF-8 (com ou sem BOM) ou Windows-1252 (seção 6.2): tenta UTF-8 estrito e, se falhar, usa 1252.
 * Para o TextDecoder, "ISO-8859-1" é o mesmo decodificador que Windows-1252 (padrão WHATWG, L27).
 */
export function detectEncoding(bytes: Uint8Array): TextEncoding {
  if (hasUtf8Bom(bytes)) return 'utf-8-bom';
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return 'utf-8';
  } catch {
    return 'windows-1252';
  }
}

/** Decodifica com a codificação escolhida. Se o usuário forçar UTF-8 num arquivo 1252, os bytes inválidos viram "�". */
export function decodeText(bytes: Uint8Array, encoding: TextEncoding): string {
  if (encoding === 'windows-1252') return new TextDecoder('windows-1252').decode(bytes);
  const body = hasUtf8Bom(bytes) ? bytes.subarray(3) : bytes;
  return new TextDecoder('utf-8', { ignoreBOM: true }).decode(body);
}

export const ENCODING_LABELS: Record<TextEncoding, string> = {
  'utf-8': 'UTF-8',
  'utf-8-bom': 'UTF-8 com BOM',
  'windows-1252': 'Windows-1252 (ISO-8859-1)',
};
