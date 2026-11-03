import { ImportError } from '../errors.ts';
import { formatInteger } from '../format/numbers.ts';
import { LIMITS } from '../params.ts';

/** Quarto passo da validação (seção 6.1): linhas, colunas e células. */
export function assertTableLimits(tableName: string, rows: number, columns: number): void {
  const where = tableName ? ` em "${tableName}"` : '';
  if (rows > LIMITS.maxRowsPerTable) {
    throw new ImportError(
      'LIMIT_EXCEEDED',
      `O arquivo tem ${formatInteger(rows)} linhas${where}; o limite é ${formatInteger(LIMITS.maxRowsPerTable)} por tabela.`,
    );
  }
  if (columns > LIMITS.maxColumnsPerTable) {
    throw new ImportError(
      'LIMIT_EXCEEDED',
      `O arquivo tem ${formatInteger(columns)} colunas${where}; o limite é ${formatInteger(LIMITS.maxColumnsPerTable)} por tabela.`,
    );
  }
}

export function assertCellLimit(totalCells: number): void {
  if (totalCells > LIMITS.maxCellsPerFile) {
    throw new ImportError(
      'LIMIT_EXCEEDED',
      `O arquivo tem ${formatInteger(totalCells)} células; o limite é ${formatInteger(LIMITS.maxCellsPerFile)} por arquivo.`,
    );
  }
}

export function assertFileSize(sizeBytes: number): void {
  if (sizeBytes > LIMITS.maxFileBytes) {
    throw new ImportError(
      'FILE_TOO_LARGE',
      `O arquivo é maior que o limite de ${formatInteger(LIMITS.maxFileBytes / 1024 / 1024)} MB.`,
    );
  }
}
