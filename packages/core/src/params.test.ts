import { describe, expect, it } from 'vitest';
import { LIMITS, PRODUCT, SESSION_TIMING, SUPPORTED_EXTENSIONS } from './params.ts';

// Garante que os parâmetros batem com a seção 0 da especificação.
describe('parâmetros da seção 0', () => {
  it('identidade', () => {
    expect(PRODUCT.name).toBe('DataKit');
    expect(PRODUCT.subtitle).toBe('Structured Data Editor');
  });

  it('formatos e limites', () => {
    expect(SUPPORTED_EXTENSIONS).toEqual(['.csv', '.xlsx', '.json']);
    expect(LIMITS.maxFileBytes).toBe(20_971_520);
    expect(LIMITS.maxRowsPerTable).toBe(100_000);
    expect(LIMITS.maxColumnsPerTable).toBe(300);
    expect(LIMITS.maxCellsPerFile).toBe(3_000_000);
    expect(LIMITS.jsonMaxDepth).toBe(32);
    expect(LIMITS.undoHistoryOps).toBe(100);
  });

  it('tempos da sessão', () => {
    expect(SESSION_TIMING.inactivityMs).toBe(7_200_000);
    expect(SESSION_TIMING.maxDurationMs).toBe(86_400_000);
    expect(SESSION_TIMING.deleteAfterCloseMs).toBe(60_000);
    expect(SESSION_TIMING.heartbeatIntervalMs).toBe(60_000);
  });
});
