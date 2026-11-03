// Reconhecimento de números em texto (seção 4.2), sem nunca alterar o texto original.
// Formato brasileiro: 1.234,56 · internacional: 1,234.56 · ambíguos (1.234, 1,234, 1234) valem nos dois.

export type NumberLocale = 'br' | 'intl';

const BR_GROUPED = /^[+-]?(\d{1,3})(?:\.\d{3})+(?:,\d+)?$/;
const BR_PLAIN = /^[+-]?(\d+)(?:,\d+)?$/;
const INTL_GROUPED = /^[+-]?(\d{1,3})(?:,\d{3})+(?:\.\d+)?$/;
const INTL_PLAIN = /^[+-]?(\d+)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

/** Parte inteira com zero à esquerda (CEP, CPF, "0012") é código, não número (docs/PLANO.md, L7). */
function hasLeadingZero(integerPart: string): boolean {
  return integerPart.length > 1 && integerPart.startsWith('0');
}

function matchInteger(re: RegExp, raw: string): string | undefined {
  const m = re.exec(raw);
  return m ? m[1] : undefined;
}

export function isNumberIn(raw: string, locale: NumberLocale): boolean {
  const integerPart =
    locale === 'br'
      ? (matchInteger(BR_GROUPED, raw) ?? matchInteger(BR_PLAIN, raw))
      : (matchInteger(INTL_GROUPED, raw) ?? matchInteger(INTL_PLAIN, raw));
  return integerPart !== undefined && !hasLeadingZero(integerPart);
}

/** Pista de formato: só um dos dois aceita o texto. */
export function numberLocaleEvidence(raw: string): NumberLocale | 'both' | 'none' {
  const br = isNumberIn(raw, 'br');
  const intl = isNumberIn(raw, 'intl');
  if (br && intl) return 'both';
  if (br) return 'br';
  if (intl) return 'intl';
  return 'none';
}

/**
 * Forma canônica do número (sem separador de milhar, ponto decimal), como texto exato.
 * Não passa por `Number`, então não perde dígitos. Devolve undefined se não for número no formato.
 */
export function toCanonicalNumber(raw: string, locale: NumberLocale): string | undefined {
  if (!isNumberIn(raw, locale)) return undefined;
  if (locale === 'br') return raw.replaceAll('.', '').replace(',', '.');
  return raw.replaceAll(',', '');
}

/** Valor aproximado (double), só para estatísticas exibidas e ordenação grosseira. */
export function toApproximateNumber(raw: string, locale: NumberLocale): number | undefined {
  const canonical = toCanonicalNumber(raw, locale);
  return canonical === undefined ? undefined : Number(canonical);
}

/**
 * Representação decimal de um double sem notação exponencial (docs/PLANO.md, L9).
 * Usa a menor representação que reproduz o valor (Number.prototype.toString).
 */
export function numberToPlainString(value: number): string {
  if (!Number.isFinite(value)) throw new RangeError(`Número não finito: ${value}`);
  if (Object.is(value, -0)) return '0';
  const text = String(value);
  const m = /^(-?)(\d)(?:\.(\d+))?e([+-]\d+)$/.exec(text);
  if (!m) return text;
  const [, sign = '', lead = '', frac = '', expText = '0'] = m;
  const digits = lead + frac;
  const exp = Number(expText);
  if (exp >= 0) {
    const pointAt = 1 + exp;
    return digits.length <= pointAt
      ? sign + digits + '0'.repeat(pointAt - digits.length)
      : `${sign}${digits.slice(0, pointAt)}.${digits.slice(pointAt)}`;
  }
  return `${sign}0.${'0'.repeat(-exp - 1)}${digits}`;
}
