import path from 'node:path';
import { defineConfig } from 'prisma/config';

// O Prisma 7 lê a URL do banco daqui (não do schema.prisma).
// Padrão de desenvolvimento: data/datakit.db na raiz do repositório.
const databaseUrl =
  process.env['DATABASE_URL'] ??
  `file:${path.resolve(import.meta.dirname, '../../data/datakit.db').replaceAll('\\', '/')}`;

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: databaseUrl },
});
