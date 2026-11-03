import { hasUtf8Bom } from '../../detect/encoding.ts';
import { assertContentMatches, fileExtension } from '../../detect/format.ts';
import { ImportError } from '../../errors.ts';
import { formatInteger } from '../../format/numbers.ts';
import { assertCellLimit, assertTableLimits } from '../../import/limits.ts';
import {
  NATIVE,
  STATE_ABSENT,
  STATE_NULL,
  STATE_VALUE,
  type NativeCode,
} from '../../model/cell.ts';
import type { DataDocument, ImportWarning } from '../../model/document.ts';
import { makeColumnNames } from '../../model/headers.ts';
import { columnData, createTable, setCell, type ColumnData } from '../../model/table.ts';
import { LIMITS } from '../../params.ts';
import { JSON_FORMAT } from '../registry.ts';
import type { FormatReader, ReadInput } from '../types.ts';
import { JsonNumber, JsonObject, parseJson, stringifyJson, type JsonValue } from './jsonParser.ts';

const ACCEPTED_ROOTS =
  'As raízes aceitas são: array de objetos, array de arrays, array de valores simples ' +
  'ou um objeto que contenha arrays de objetos.';

export type JsonRootKind = 'objects' | 'arrays' | 'values' | 'empty';

/** Estrutura da raiz, para a pré-visualização decidir o que perguntar (L32). */
export type JsonStructure = {
  rootIsObject: boolean;
  /** Raiz objeto: caminhos dos arrays de objetos encontrados, na ordem do arquivo. */
  candidates: string[][];
  kind: JsonRootKind;
};

export function decodeJsonText(bytes: Uint8Array): string {
  const body = hasUtf8Bom(bytes) ? bytes.subarray(3) : bytes;
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(body);
  } catch {
    throw new ImportError(
      'INVALID_FILE',
      'O JSON precisa estar em UTF-8, e este arquivo não está.',
    );
  }
}

const isObjectArray = (v: JsonValue): v is JsonObject[] =>
  Array.isArray(v) && v.length > 0 && v.every((item) => item instanceof JsonObject);

/** Arrays de objetos dentro de um objeto (procura também em objetos aninhados). */
export function findObjectArrays(root: JsonObject, prefix: string[] = []): string[][] {
  const found: string[][] = [];
  root.keys.forEach((key, k) => {
    const value = root.values[k] ?? null;
    const path = [...prefix, key];
    if (isObjectArray(value)) found.push(path);
    else if (value instanceof JsonObject) found.push(...findObjectArrays(value, path));
  });
  return found;
}

function valueAtPath(root: JsonObject, path: readonly string[]): JsonValue | undefined {
  let current: JsonValue = root;
  for (const key of path) {
    if (!(current instanceof JsonObject)) return undefined;
    const k: number = current.keys.indexOf(key);
    if (k < 0) return undefined;
    current = current.values[k] ?? null;
  }
  return current;
}

function rootKind(items: JsonValue[]): JsonRootKind {
  if (items.length === 0) return 'empty';
  if (items.every((v) => v instanceof JsonObject)) return 'objects';
  if (items.every((v) => Array.isArray(v))) return 'arrays';
  if (items.every((v) => !(v instanceof JsonObject) && !Array.isArray(v))) return 'values';
  throw new ImportError(
    'INVALID_FILE',
    'O array principal mistura tipos diferentes (por exemplo, objetos e valores simples). ' +
      ACCEPTED_ROOTS,
  );
}

function leafCell(value: JsonValue): { state: 0 | 1; raw: string; native: NativeCode } {
  if (value === null) return { state: STATE_NULL, raw: '', native: NATIVE.none };
  if (typeof value === 'string') return { state: STATE_VALUE, raw: value, native: NATIVE.string };
  if (typeof value === 'boolean') {
    return { state: STATE_VALUE, raw: value ? 'true' : 'false', native: NATIVE.boolean };
  }
  if (value instanceof JsonNumber) {
    return { state: STATE_VALUE, raw: value.raw, native: NATIVE.number };
  }
  // Arrays e objetos vazios ficam como texto JSON, marcados com o tipo "json" (seção 6.4, L21).
  return { state: STATE_VALUE, raw: stringifyJson(value), native: NATIVE.json };
}

type ColumnSpec = { path: string[]; occurrences: number[] };

/** Achata objetos aninhados em colunas com caminho (seção 6.4). */
function collectLeaves(
  obj: JsonObject,
  prefix: ColumnSpec,
  visit: (spec: ColumnSpec, value: JsonValue) => void,
): number {
  let duplicates = 0;
  const seen = new Map<string, number>();
  obj.keys.forEach((key, k) => {
    const occurrence = seen.get(key) ?? 0;
    seen.set(key, occurrence + 1);
    if (occurrence > 0) duplicates += 1;
    const spec = { path: [...prefix.path, key], occurrences: [...prefix.occurrences, occurrence] };
    const value = obj.values[k] ?? null;
    if (value instanceof JsonObject && value.keys.length > 0) {
      duplicates += collectLeaves(value, spec, visit);
    } else {
      visit(spec, value);
    }
  });
  return duplicates;
}

const specKey = (spec: ColumnSpec): string => JSON.stringify([spec.path, spec.occurrences]);

function tableFromObjects(rows: JsonObject[], warnings: ImportWarning[]) {
  const specs: ColumnSpec[] = [];
  const index = new Map<string, number>();
  let objectsWithDuplicates = 0;
  for (const row of rows) {
    const duplicates = collectLeaves(row, { path: [], occurrences: [] }, (spec) => {
      const key = specKey(spec);
      if (!index.has(key)) {
        index.set(key, specs.length);
        specs.push(spec);
      }
    });
    if (duplicates > 0) objectsWithDuplicates += 1;
    if (specs.length > LIMITS.maxColumnsPerTable) {
      assertTableLimits('', rows.length, specs.length);
    }
  }
  assertTableLimits('', rows.length, specs.length);
  assertCellLimit(rows.length * specs.length);

  if (objectsWithDuplicates > 0) {
    warnings.push({
      code: 'JSON_DUPLICATE_KEYS',
      message: `${formatInteger(objectsWithDuplicates)} objetos tinham chaves repetidas; cada repetição virou uma coluna separada.`,
    });
  }

  const { names } = makeColumnNames(specs.map((s) => s.path.join('.')));
  const table = createTable({
    id: 't0',
    name: 'JSON',
    columns: specs.map((spec, i) => ({
      name: names[i] ?? spec.path.join('.'),
      path: spec.path,
      ...(spec.occurrences.some((o) => o > 0) ? { pathOccurrences: spec.occurrences } : {}),
    })),
    rowCount: rows.length,
    defaultState: STATE_ABSENT,
  });
  const data = table.columns.map((c) => columnData(table, c.id));
  rows.forEach((row, rowId) => {
    collectLeaves(row, { path: [], occurrences: [] }, (spec, value) => {
      const col = index.get(specKey(spec));
      const target = col === undefined ? undefined : data[col];
      if (target) {
        const cell = leafCell(value);
        setCell(target, rowId, cell.state, cell.raw, cell.native);
      }
    });
  });
  return table;
}

function tableFromArrays(rows: JsonValue[][], hasHeader: boolean, warnings: ImportWarning[]) {
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const headerRow = hasHeader ? rows[0] : undefined;
  const dataRows = headerRow ? rows.slice(1) : rows;
  assertTableLimits('', dataRows.length, width);
  assertCellLimit(dataRows.length * width);

  const { names, renamed } = makeColumnNames(
    Array.from({ length: width }, (_, i) => {
      const v = headerRow?.[i];
      if (v === undefined || v === null) return undefined;
      return typeof v === 'string' ? v : leafCell(v).raw;
    }),
  );
  if (hasHeader && renamed > 0) {
    warnings.push({
      code: 'HEADERS_RENAMED',
      message: `${formatInteger(renamed)} nomes de coluna vazios ou repetidos foram ajustados.`,
    });
  }

  const table = createTable({
    id: 't0',
    name: 'JSON',
    columns: names.map((name) => ({ name })),
    rowCount: dataRows.length,
    defaultState: STATE_ABSENT,
  });
  const data: ColumnData[] = table.columns.map((c) => columnData(table, c.id));
  dataRows.forEach((row, rowId) => {
    row.forEach((value, col) => {
      const target = data[col];
      if (!target) return;
      const cell = leafCell(value);
      setCell(target, rowId, cell.state, cell.raw, cell.native);
    });
  });
  return table;
}

function tableFromValues(items: JsonValue[]) {
  assertTableLimits('', items.length, 1);
  const table = createTable({
    id: 't0',
    name: 'JSON',
    columns: [{ name: 'valor' }],
    rowCount: items.length,
    defaultState: STATE_ABSENT,
  });
  const data = columnData(table, 'c0');
  items.forEach((value, rowId) => {
    const cell = leafCell(value);
    setCell(data, rowId, cell.state, cell.raw, cell.native);
  });
  return table;
}

/** Lê e analisa a estrutura sem montar a tabela (pré-visualização). */
export function inspectJson(bytes: Uint8Array): { root: JsonValue; structure: JsonStructure } {
  assertContentMatches('json', bytes);
  const root = parseJson(decodeJsonText(bytes), LIMITS.jsonMaxDepth);
  if (root instanceof JsonObject) {
    const candidates = findObjectArrays(root);
    if (candidates.length === 0) {
      throw new ImportError(
        'INVALID_FILE',
        `O objeto principal do JSON não contém nenhum array de objetos. ${ACCEPTED_ROOTS}`,
      );
    }
    return { root, structure: { rootIsObject: true, candidates, kind: 'objects' } };
  }
  if (!Array.isArray(root)) {
    throw new ImportError('INVALID_FILE', `O JSON contém só um valor simples. ${ACCEPTED_ROOTS}`);
  }
  return { root, structure: { rootIsObject: false, candidates: [], kind: rootKind(root) } };
}

export function readJson({ bytes, fileName, options }: ReadInput): DataDocument {
  const { root, structure } = inspectJson(bytes);
  const warnings: ImportWarning[] = [];

  let items: JsonValue[];
  let jsonRootPath: string[] | undefined;
  if (root instanceof JsonObject) {
    const path = options.jsonRootPath ?? structure.candidates[0] ?? [];
    const chosen = valueAtPath(root, path);
    if (!chosen || !isObjectArray(chosen)) {
      throw new ImportError(
        'INVALID_FILE',
        `O caminho "${path.join('.')}" não aponta para um array de objetos neste JSON.`,
      );
    }
    items = chosen;
    jsonRootPath = path;
    warnings.push({
      code: 'JSON_PARTIAL_ROOT',
      message: `Só o array "${path.join('.')}" foi importado; o restante do objeto principal não entra na tabela.`,
    });
  } else {
    items = root as JsonValue[];
  }

  const limited = options.maxRows === undefined ? items : items.slice(0, options.maxRows + 1);
  const kind = jsonRootPath ? 'objects' : structure.kind;
  const hasHeader = kind === 'arrays' ? (options.hasHeader ?? true) : false;

  let table;
  if (kind === 'objects') table = tableFromObjects(limited as JsonObject[], warnings);
  else if (kind === 'arrays')
    table = tableFromArrays(limited as JsonValue[][], hasHeader, warnings);
  else table = tableFromValues(limited);

  table.name = fileName;
  return {
    source: {
      fileName,
      extension: fileExtension(fileName),
      format: 'json',
      sizeBytes: bytes.length,
      importedAt: new Date().toISOString(),
      hasHeader,
      encoding: hasUtf8Bom(bytes) ? 'utf-8-bom' : 'utf-8',
      ...(jsonRootPath ? { jsonRootPath } : {}),
    },
    tables: [table],
    warnings,
  };
}

export const jsonReader: FormatReader = { descriptor: JSON_FORMAT, read: readJson };
