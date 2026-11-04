// Teste de desempenho isolado (seção 13): só os testes "desempenho", um por vez, com as metas
// sem folga (PERF_STRICT=1). Argumentos extras vão para o Playwright (ex.: --project=chromium).
import { spawnSync } from 'node:child_process';

const result = spawnSync(
  'npx',
  ['playwright', 'test', '--grep', 'desempenho', '--workers=1', ...process.argv.slice(2)],
  { stdio: 'inherit', shell: true, env: { ...process.env, PERF_STRICT: '1' } },
);
process.exit(result.status ?? 1);
