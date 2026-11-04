import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/** No desenvolvimento, /metrics abre a página do painel (em produção, quem faz isso é a API). */
const metricsPage: Plugin = {
  name: 'datakit-metrics-page',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      if (req.url === '/metrics' || req.url?.startsWith('/metrics?')) {
        req.url = req.url.replace('/metrics', '/metrics.html');
      }
      next();
    });
  },
};

export default defineConfig({
  plugins: [react(), metricsPage],
  resolve: {
    // Usa o código-fonte do core direto, sem precisar compilá-lo antes.
    alias: {
      '@datakit/core': fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:3000',
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    // Duas páginas: o editor e o painel de métricas, que não pesa no editor.
    rolldownOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        metrics: fileURLToPath(new URL('./metrics.html', import.meta.url)),
      },
    },
  },
});
