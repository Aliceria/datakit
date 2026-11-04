import { describe, expect, it } from 'vitest';
import { maskIp, normalizeIp, originHmac } from './ip.ts';

describe('normalização do IP', () => {
  it('IPv4, IPv4 mapeado e IPv6 na forma curta', () => {
    expect(normalizeIp('189.45.123.201')).toBe('189.45.123.201');
    expect(normalizeIp('::ffff:189.45.123.201')).toBe('189.45.123.201');
    expect(normalizeIp('::FFFF:10.0.0.1')).toBe('10.0.0.1');
    expect(normalizeIp('2804:014C:5B8A:0000:0000:0000:0000:0001')).toBe('2804:14c:5b8a::1');
    expect(normalizeIp('fe80::1%eth0')).toBe('fe80::1');
  });

  it('valores que não são IP ficam sem origem', () => {
    expect(normalizeIp(undefined)).toBeUndefined();
    expect(normalizeIp('')).toBeUndefined();
    expect(normalizeIp('desconhecido')).toBeUndefined();
    expect(normalizeIp('999.1.1.1')).toBeUndefined();
  });
});

describe('máscara do IP', () => {
  it('esconde os últimos 6 caracteres e mantém os separadores', () => {
    expect(maskIp('189.45.123.201')).toBe('189.45.***.***');
    expect(maskIp('10.0.0.1')).toBe('**.*.*.*');
    expect(maskIp('2804:14c:5b8a:1234::1')).toBe('2804:14c:5b8*:****::*');
    expect(maskIp('::1')).toBe('::*');
  });
});

describe('HMAC da origem', () => {
  it('mesmo IP e chave dão o mesmo valor; chave diferente muda tudo; o IP não aparece', () => {
    const key = 'k'.repeat(32);
    const a = originHmac('189.45.123.201', key);
    expect(a).toBe(originHmac('189.45.123.201', key));
    expect(a).not.toBe(originHmac('189.45.123.201', 'x'.repeat(32)));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toContain('189');
  });
});
