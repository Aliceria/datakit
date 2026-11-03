import { createApp } from './app.ts';
import { loadConfig } from './config/env.ts';
import { applyPragmas } from './persistence/pragmas.ts';
import { createPrisma } from './persistence/prisma.ts';
import { log } from './utils/log.ts';

const config = loadConfig();
const db = createPrisma(config.databaseUrl);
const pragmas = await applyPragmas(db);
log.info('banco pronto', { journalMode: pragmas.journalMode, autoVacuum: pragmas.autoVacuum });

const app = createApp({ config, db });
const server = app.listen(config.port, config.host, () => {
  log.info('DataKit API ouvindo', { host: config.host, port: config.port });
});

function shutdown(signal: string): void {
  log.info('encerrando', { signal });
  server.close(() => {
    void db.$disconnect().finally(() => process.exit(0));
  });
  // Não espera conexões presas para sempre.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => {
  shutdown('SIGINT');
});
process.on('SIGTERM', () => {
  shutdown('SIGTERM');
});
