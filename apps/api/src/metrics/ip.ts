import crypto from 'node:crypto';
import net from 'node:net';

// IP de origem para as métricas. O Express já resolve `req.ip` com o `trust proxy` configurado
// (TRUST_PROXY = número de proxies confiáveis na frente): sem proxy configurado, um
// X-Forwarded-For enviado pelo próprio visitante é ignorado. Aqui só normalizamos o texto.

/** Normaliza o IP: IPv4 mapeado (::ffff:1.2.3.4) vira IPv4; IPv6 vai para a forma curta. */
export function normalizeIp(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  // Zona do IPv6 (fe80::1%eth0) não identifica a origem.
  const ip = raw.trim().split('%')[0] ?? '';
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (mapped?.[1] && net.isIPv4(mapped[1])) return mapped[1];
  if (net.isIPv4(ip)) return ip;
  if (net.isIPv6(ip)) {
    // O parser de URL escreve o IPv6 na forma canônica curta, em minúsculas.
    const host = new URL(`http://[${ip}]/`).hostname;
    const canonical = host.slice(1, -1);
    const inner = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(canonical);
    if (inner?.[1] && inner[2]) {
      const hi = Number.parseInt(inner[1], 16);
      const lo = Number.parseInt(inner[2], 16);
      return `${String(hi >> 8)}.${String(hi & 255)}.${String(lo >> 8)}.${String(lo & 255)}`;
    }
    return canonical;
  }
  return undefined;
}

const HIDDEN = 6;

/**
 * Esconde os últimos 6 caracteres do IP, mantendo pontos e dois-pontos no lugar para a forma
 * continuar reconhecível: 189.45.123.201 → 189.45.***.***
 */
export function maskIp(ip: string): string {
  // IP normalizado só tem caracteres ASCII.
  const chars = Array.from(ip);
  let hidden = 0;
  for (let i = chars.length - 1; i >= 0 && hidden < HIDDEN; i -= 1) {
    const ch = chars[i];
    if (ch === '.' || ch === ':') continue;
    chars[i] = '*';
    hidden += 1;
  }
  return chars.join('');
}

/** HMAC-SHA-256 do IP com a chave do .env: identifica a origem sem guardar o IP. */
export function originHmac(ip: string, key: string): string {
  return crypto.createHmac('sha256', key).update(ip).digest('hex');
}
