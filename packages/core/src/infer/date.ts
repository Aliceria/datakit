// Datas reconhecidas (seção 4.2): dd/mm/aaaa (com ou sem hora; padrão nos casos ambíguos),
// aaaa-mm-dd e ISO 8601. Validação manual: nunca Date.parse, que varia entre motores.

export type DateFormat = 'dmy' | 'ymd' | 'iso';

export type DateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const DMY = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/;
const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})?$/;

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function build(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): DateParts | undefined {
  if (month < 1 || month > 12) return undefined;
  if (day < 1 || day > daysInMonth(year, month)) return undefined;
  if (hour > 23 || minute > 59 || second > 59) return undefined;
  return { year, month, day, hour, minute, second };
}

const num = (s: string | undefined): number => (s === undefined ? 0 : Number(s));

export function parseDate(raw: string): { format: DateFormat; parts: DateParts } | undefined {
  let m = DMY.exec(raw);
  if (m) {
    const parts = build(num(m[3]), num(m[2]), num(m[1]), num(m[4]), num(m[5]), num(m[6]));
    return parts && { format: 'dmy', parts };
  }
  m = YMD.exec(raw);
  if (m) {
    const parts = build(num(m[1]), num(m[2]), num(m[3]));
    return parts && { format: 'ymd', parts };
  }
  m = ISO.exec(raw);
  if (m) {
    const parts = build(num(m[1]), num(m[2]), num(m[3]), num(m[4]), num(m[5]), num(m[6]));
    return parts && { format: 'iso', parts };
  }
  return undefined;
}

const pad = (n: number, size = 2): string => String(n).padStart(size, '0');

/** Texto ISO "ingênuo" (sem fuso): aaaa-mm-dd ou aaaa-mm-ddThh:mm:ss. */
export function formatIsoDate(parts: DateParts, withTime: boolean): string {
  const date = `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)}`;
  return withTime ? `${date}T${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}` : date;
}

/** Comparável cronologicamente (mesma escala para os três formatos). */
export function dateSortKey(parts: DateParts): number {
  return (
    ((((parts.year * 13 + parts.month) * 32 + parts.day) * 24 + parts.hour) * 60 + parts.minute) *
      60 +
    parts.second
  );
}
