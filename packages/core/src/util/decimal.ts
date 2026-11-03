// Comparação exata de números em texto (docs/PLANO.md, 6.1): nunca passa por Number, então
// 12345678901234567890 e 12345678901234567891 continuam diferentes.

export type Decimal = { negative: boolean; int: string; frac: string };

const PLAIN = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/;

/** Lê um número canônico (ponto decimal, sem milhar; expoente aceito) num decimal exato. */
export function parseDecimal(text: string): Decimal | undefined {
  const m = PLAIN.exec(text);
  if (!m || (m[2] === '' && (m[3] ?? '') === '')) return undefined;
  let digits = (m[2] ?? '') + (m[3] ?? '');
  let point = (m[2] ?? '').length + Number(m[4] ?? '0');
  if (point < 0) {
    digits = '0'.repeat(-point) + digits;
    point = 0;
  }
  if (point > digits.length) digits += '0'.repeat(point - digits.length);
  const int = digits.slice(0, point).replace(/^0+/, '');
  const frac = digits.slice(point).replace(/0+$/, '');
  const zero = int === '' && frac === '';
  return { negative: m[1] === '-' && !zero, int, frac };
}

function compareMagnitude(a: Decimal, b: Decimal): number {
  if (a.int.length !== b.int.length) return a.int.length < b.int.length ? -1 : 1;
  if (a.int !== b.int) return a.int < b.int ? -1 : 1;
  const len = Math.max(a.frac.length, b.frac.length);
  const fa = a.frac.padEnd(len, '0');
  const fb = b.frac.padEnd(len, '0');
  if (fa === fb) return 0;
  return fa < fb ? -1 : 1;
}

export function compareDecimal(a: Decimal, b: Decimal): number {
  if (a.negative !== b.negative) return a.negative ? -1 : 1;
  const m = compareMagnitude(a, b);
  return a.negative ? -m : m;
}
