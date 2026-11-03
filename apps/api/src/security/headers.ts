import helmet from 'helmet';

/**
 * Cabeçalhos de segurança e CSP restritiva (seção 12): nada de CDN, nada de script ou estilo inline.
 * Estilos aplicados pelo React via `style={...}` usam o CSSOM e não são bloqueados por `style-src 'self'`.
 */
export function securityHeaders(isProduction: boolean) {
  return helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        workerSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        // Em http://localhost (testes) o upgrade quebraria as requisições.
        upgradeInsecureRequests: isProduction ? [] : null,
      },
    },
    // HSTS só faz sentido atrás do HTTPS do Nginx.
    strictTransportSecurity: isProduction,
    referrerPolicy: { policy: 'no-referrer' },
    crossOriginEmbedderPolicy: false,
  });
}
