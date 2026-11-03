import { rateLimit } from 'express-rate-limit';
import { ApiError } from '../utils/httpErrors.ts';

/**
 * Limite genérico por IP contra enxurrada de requisições.
 * Os limites de negócio da seção 0 (importações por hora, sessões ativas) são contados no banco,
 * nas próprias rotas, a partir da Etapa 3.
 */
export function generalRateLimit(perMinute: number) {
  return rateLimit({
    windowMs: 60_000,
    limit: perMinute,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, _res, next) => {
      next(
        new ApiError(
          429,
          'RATE_LIMITED',
          'Muitas requisições em pouco tempo. Aguarde um minuto e tente novamente.',
        ),
      );
    },
  });
}
