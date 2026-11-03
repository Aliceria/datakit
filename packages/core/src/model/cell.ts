// Estado e tipo nativo de uma célula (docs/PLANO.md, seção 4.1).
// "Vazio" e "só espaços" são STATE_VALUE com raw "" ou só com espaços.

export const STATE_VALUE = 0;
export const STATE_NULL = 1;
export const STATE_ABSENT = 2;
export type CellState = typeof STATE_VALUE | typeof STATE_NULL | typeof STATE_ABSENT;

/** Tipo que a célula tinha no formato de origem (JSON e XLSX têm tipos; CSV não). */
export const NATIVE = {
  none: 0,
  string: 1,
  number: 2,
  boolean: 3,
  date: 4,
  error: 5,
  json: 6,
} as const;
export type NativeType = keyof typeof NATIVE;
export type NativeCode = (typeof NATIVE)[NativeType];

const NATIVE_NAMES: readonly NativeType[] = [
  'none',
  'string',
  'number',
  'boolean',
  'date',
  'error',
  'json',
];

export function nativeName(code: number): NativeType {
  return NATIVE_NAMES[code] ?? 'none';
}

export type CellExtras = {
  /** Fórmula original do XLSX, com "=" na frente. Só leitura. */
  formula?: string;
};

/** Leitura de uma célula, para quem não precisa da representação colunar. */
export type CellView = {
  state: CellState;
  /** Texto original; "" quando o estado não é STATE_VALUE. */
  raw: string;
  native: NativeCode;
  extras: CellExtras | undefined;
};

/** Texto composto só de espaços em branco (e não vazio). */
export function isWhitespaceOnly(raw: string): boolean {
  return raw.length > 0 && raw.trim() === '';
}
