// Sobe a API (porta 3000) e o Vite (porta 5173, com proxy de /api) juntos.
// Ctrl+C encerra os dois.
import { spawn } from 'node:child_process';

// A porta da API é fixa aqui: o proxy do Vite aponta para ela. Um PORT herdado do ambiente
// (por exemplo, de quem iniciou este script) não pode mudá-la.
const apiPort = process.env.API_PORT ?? '3000';

const workspaces = [
  { name: '@datakit/api', env: { ...process.env, PORT: apiPort } },
  { name: '@datakit/web', env: { ...process.env } },
];

/** @type {import('node:child_process').ChildProcess[]} */
const children = [];
let stopping = false;

function stopAll() {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
}

for (const { name, env } of workspaces) {
  // Comando inteiro numa string: no Windows o npm precisa de shell.
  const child = spawn(`npm run dev -w ${name}`, { stdio: 'inherit', shell: true, env });
  child.on('exit', (code) => {
    console.log(`[dev] ${name} terminou (código ${String(code)})`);
    stopAll();
  });
  children.push(child);
}

process.on('SIGINT', stopAll);
process.on('SIGTERM', stopAll);
