import { z } from 'zod';
import type { LogOp } from '@datakit/core';

// Operações recebidas do navegador (docs/PLANO.md, seção 7). O servidor valida a forma aqui e
// aplica o efeito na compactação, com as mesmas funções do core. Nada de chaves inesperadas.

const MAX_ROW_ID = 10_000_000;
const MAX_ITEMS = 3_100_000;

const tableId = z.string().regex(/^t\d{1,4}$/);
const colId = z.string().regex(/^c\d{1,7}$/);
const rowId = z.number().int().min(0).max(MAX_ROW_ID);

const cellValue = z
  .object({
    s: z.union([z.literal(0), z.literal(1), z.literal(2)]),
    r: z.string().optional(),
    t: z.number().int().min(0).max(7),
    x: z
      .object({ formula: z.string().max(100_000).optional() })
      .strict()
      .optional(),
  })
  .strict();

const column = z
  .object({
    id: colId,
    name: z.string().max(10_000),
    path: z.array(z.string().max(10_000)).max(64).optional(),
    pathOccurrences: z.array(z.number().int().min(0)).max(64).optional(),
  })
  .strict();

const cellsRecord = z.record(z.string().regex(/^(c\d{1,7}|\d{1,8})$/), cellValue);

const effect: z.ZodType = z.lazy(() =>
  z.discriminatedUnion('type', [
    z
      .object({
        type: z.literal('setCells'),
        tableId,
        cells: z.array(z.object({ rowId, colId, value: cellValue }).strict()).max(MAX_ITEMS),
      })
      .strict(),
    z
      .object({
        type: z.literal('insertRows'),
        tableId,
        rows: z
          .array(
            z
              .object({ rowId, index: z.number().int().min(0), cells: cellsRecord.optional() })
              .strict(),
          )
          .max(MAX_ITEMS),
      })
      .strict(),
    z
      .object({ type: z.literal('deleteRows'), tableId, rowIds: z.array(rowId).max(MAX_ITEMS) })
      .strict(),
    z
      .object({
        type: z.literal('insertColumns'),
        tableId,
        columns: z
          .array(
            z
              .object({ column, index: z.number().int().min(0), cells: cellsRecord.optional() })
              .strict(),
          )
          .max(1000),
      })
      .strict(),
    z
      .object({ type: z.literal('deleteColumns'), tableId, colIds: z.array(colId).max(1000) })
      .strict(),
    z
      .object({ type: z.literal('reorderRows'), tableId, order: z.array(rowId).max(MAX_ITEMS) })
      .strict(),
    z
      .object({
        type: z.literal('renameColumn'),
        tableId,
        colId,
        name: z.string().max(10_000),
        path: z.array(z.string().max(10_000)).max(64).optional(),
      })
      .strict(),
    z.object({ type: z.literal('batch'), effects: z.array(effect).max(100) }).strict(),
  ]),
);

const opBase = {
  seq: z.number().int().min(1),
  opId: z.uuid(),
};

export const logOpSchema = z.discriminatedUnion('kind', [
  z.object({ ...opBase, kind: z.literal('edit'), label: z.string().max(200), effect }).strict(),
  z.object({ ...opBase, kind: z.literal('undo') }).strict(),
  z.object({ ...opBase, kind: z.literal('redo') }).strict(),
  z
    .object({
      ...opBase,
      kind: z.literal('exported'),
      tableIds: z.array(tableId).min(1).max(1000),
    })
    .strict(),
]);

export const opsBodySchema = z
  .object({
    instanceId: z.string(),
    ops: z.array(logOpSchema).min(1).max(1000),
  })
  .strict();

/**
 * Depois da validação o objeto tem a forma de LogOp; os `undefined` explícitos que o zod poderia
 * produzir não aparecem porque o JSON de entrada não tem como representá-los.
 */
export const asLogOp = (op: z.infer<typeof logOpSchema>): LogOp => op as LogOp;
