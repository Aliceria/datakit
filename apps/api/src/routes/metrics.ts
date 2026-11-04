import { Router } from 'express';
import type { MetricsRecorder } from '../metrics/recorder.ts';

// Rotas públicas das métricas. A consulta dos números (painel) é protegida e entra na etapa M2.
export function metricsRouter(metrics: MetricsRecorder): Router {
  const router = Router();

  // Abertura do editor. Responde na hora; o registro roda em segundo plano.
  router.post('/metrics/visit', (req, res) => {
    metrics.visit(req);
    res.status(204).end();
  });

  return router;
}
