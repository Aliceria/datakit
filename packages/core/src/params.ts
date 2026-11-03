// Parâmetros do projeto (docs/SPEC.md, seção 0).
// Fonte única para o navegador e o servidor: para mudar um comportamento, mude aqui.

export const PRODUCT = {
  name: 'DataKit',
  subtitle: 'Structured Data Editor',
  url: 'https://datakit.rking.com.br',
} as const;

export const SUPPORTED_EXTENSIONS = ['.csv', '.xlsx', '.json'] as const;

export const LIMITS = {
  maxFileBytes: 20 * 1024 * 1024,
  maxRowsPerTable: 100_000,
  maxColumnsPerTable: 300,
  maxCellsPerFile: 3_000_000,
  xlsxMaxUncompressedBytes: 200 * 1024 * 1024,
  xlsxMaxZipEntries: 10_000,
  jsonMaxDepth: 32,
  undoHistoryOps: 100,
  importsPerIpPerHour: 30,
  activeSessionsPerIp: 10,
  maxDatabaseBytes: 5 * 1024 * 1024 * 1024,
} as const;

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

export const SESSION_TIMING = {
  inactivityMs: 2 * HOUR,
  maxDurationMs: 24 * HOUR,
  deleteAfterCloseMs: 60 * SECOND,
  heartbeatIntervalMs: 60 * SECOND,
  cleanupIntervalMs: 5 * MINUTE,
} as const;
