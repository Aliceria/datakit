// Formatação de números para exibição em pt-BR.
// Só para textos da interface; valores de células nunca passam por aqui.

const integerFormatter = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });

export function formatInteger(value: number): string {
  return integerFormatter.format(value);
}

/** Tamanho em bytes no estilo "1,5 MB" (base 1024, como o sistema operacional mostra). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    throw new RangeError(`Tamanho inválido: ${bytes}`);
  }
  const units = ['bytes', 'KB', 'MB', 'GB'] as const;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  if (unit === 0) {
    return `${formatInteger(value)} ${value === 1 ? 'byte' : 'bytes'}`;
  }
  const rounded = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(value);
  return `${rounded} ${units[unit]}`;
}
