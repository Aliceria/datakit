import { describe, expect, it } from 'vitest';
import { formatBytes, formatInteger } from './numbers.ts';

describe('formatInteger', () => {
  it('usa ponto como separador de milhar', () => {
    expect(formatInteger(3_000_000)).toBe('3.000.000');
    expect(formatInteger(100_000)).toBe('100.000');
    expect(formatInteger(300)).toBe('300');
  });
});

describe('formatBytes', () => {
  it('formata bytes, KB, MB e GB com vírgula decimal', () => {
    expect(formatBytes(0)).toBe('0 bytes');
    expect(formatBytes(1)).toBe('1 byte');
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(1536)).toBe('1,5 KB');
    expect(formatBytes(20 * 1024 * 1024)).toBe('20 MB');
    expect(formatBytes(5 * 1024 ** 3)).toBe('5 GB');
  });

  it('rejeita valores inválidos', () => {
    expect(() => formatBytes(-1)).toThrow(RangeError);
    expect(() => formatBytes(Number.NaN)).toThrow(RangeError);
  });
});
