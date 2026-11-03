// Sobe o servidor de produção para o Playwright com um banco novo a cada execução.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const apiDir = path.join(root, 'apps', 'api');
const dbUrl = process.env.DATABASE_URL;
if (!dbUrl?.startsWith('file:')) {
  console.error('DATABASE_URL precisa ser definido com "file:"');
  process.exit(1);
}

const dbFile = dbUrl.slice('file:'.length);
fs.rmSync(path.dirname(dbFile), { recursive: true, force: true });
fs.mkdirSync(path.dirname(dbFile), { recursive: true });

if (!fs.existsSync(path.join(apiDir, 'dist', 'server.js'))) {
  console.error('Build não encontrado. Rode "npm run build" antes.');
  process.exit(1);
}

const migrate = spawnSync('npx', ['prisma', 'migrate', 'deploy'], {
  cwd: apiDir,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
if (migrate.status !== 0) process.exit(migrate.status ?? 1);

const server = spawn(process.execPath, ['dist/server.js'], { cwd: apiDir, stdio: 'inherit' });
for (const signal of /** @type {const} */ (['SIGINT', 'SIGTERM'])) {
  process.on(signal, () => server.kill(signal));
}
server.on('exit', (code) => process.exit(code ?? 0));
