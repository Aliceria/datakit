import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/** Gera o CSV de 100.000 linhas (não versionado) antes dos testes, se ainda não existir. */
export default function globalSetup(): void {
  const root = path.resolve(import.meta.dirname, '..');
  if (fs.existsSync(path.join(root, 'fixtures', 'large', '100k.csv'))) return;
  const result = spawnSync(process.execPath, ['scripts/generate-fixtures.ts', '--large'], {
    cwd: root,
    stdio: 'inherit',
  });
  if (result.status !== 0) throw new Error('Falha ao gerar os fixtures grandes');
}
