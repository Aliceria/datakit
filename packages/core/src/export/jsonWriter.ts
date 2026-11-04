// Escritor JSON próprio (L1): escreve as chaves como texto, na ordem das colunas, sem montar
// objetos JS (chaves como `__proto__` são seguras) e com os números no texto original.

import type { Column, Table } from '../model/table.ts';
import { outputValue, type OutContext, type OutValue } from './cellOutput.ts';

export type JsonOptions = {
  shape: 'objects' | 'arrays';
  /** Reconstruir objetos aninhados pelos caminhos das colunas (origem JSON aninhada). */
  nested: boolean;
  indent: boolean;
};

export type JsonResult = { text: string };

const str = (s: string): string => JSON.stringify(s);

function pad(level: number, indent: boolean): string {
  return indent ? `\n${'  '.repeat(level)}` : '';
}

/** Texto JSON de um valor que existe (ausente é tratado por quem chama). */
function valueText(out: OutValue): string {
  switch (out.kind) {
    case 'absent':
    case 'null':
      return 'null';
    case 'empty':
      return '""';
    case 'string':
      return str(out.text);
    case 'number':
    case 'json':
      return out.text;
    case 'boolean':
      return out.value ? 'true' : 'false';
    case 'date': {
      const p = out.parts;
      const d = `${String(p.year).padStart(4, '0')}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
      const t = `T${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}:${String(p.second).padStart(2, '0')}`;
      return str(out.withTime ? d + t : d);
    }
  }
}

// --- Reconstrução de objetos aninhados ------------------------------------------------------------

/** Nó da árvore de chaves: folha = coluna; ramo = objeto com filhos, na ordem de aparição. */
type KeyNode = { key: string; colId?: string; children: KeyNode[] };

/** Caminho de saída de cada coluna: o caminho original (JSON) ou o nome, como chave única. */
function keyPath(column: Column, nested: boolean): Array<{ key: string; occ: number }> {
  if (!nested || !column.path) return [{ key: column.name, occ: 0 }];
  // Nome trocado pelo usuário: a última chave do caminho acompanha (L22).
  return column.path.map((key, i) => ({ key, occ: column.pathOccurrences?.[i] ?? 0 }));
}

function buildTree(columns: readonly Column[], nested: boolean): KeyNode[] {
  const root: KeyNode = { key: '', children: [] };
  const index = new Map<KeyNode, Map<string, KeyNode>>();
  for (const column of columns) {
    let node = root;
    const path = keyPath(column, nested);
    path.forEach((step, i) => {
      const id = `${String(step.occ)}\u0001${step.key}`;
      let children = index.get(node);
      if (!children) {
        children = new Map();
        index.set(node, children);
      }
      let child = children.get(id);
      const leaf = i === path.length - 1;
      // Duas colunas com o mesmo caminho completo (não deveria acontecer): a segunda vira chave própria.
      if (!child || (leaf && child.colId !== undefined)) {
        child = { key: step.key, children: [] };
        children.set(leaf && children.has(id) ? `${id}\u0002${column.id}` : id, child);
        node.children.push(child);
      }
      if (leaf) child.colId = column.id;
      node = child;
    });
  }
  return root.children;
}

/**
 * L20: linhas em que uma coluna e outra "dentro" dela têm valor (ex.: `a` = 1 e `a.b` = 2).
 * Não dá para reconstruir sem escolher um dos dois; o diálogo oferece exportar sem reconstrução.
 */
export function findNestingConflicts(
  table: Table,
  rowIds: readonly number[],
  colIds: readonly string[],
): number[] {
  const columns = colIds
    .map((id) => table.columns.find((c) => c.id === id))
    .filter((c) => c !== undefined);
  const tree = buildTree(columns, true);
  const pairs: Array<[string, string[]]> = [];
  const descendants = (node: KeyNode): string[] =>
    node.children.flatMap((c) => [...(c.colId ? [c.colId] : []), ...descendants(c)]);
  const walk = (nodes: KeyNode[]) => {
    for (const node of nodes) {
      if (node.colId && node.children.length > 0) pairs.push([node.colId, descendants(node)]);
      walk(node.children);
    }
  };
  walk(tree);
  if (pairs.length === 0) return [];
  const ctx: OutContext = { format: 'json', stats: { longNumbers: 0 } };
  const present = (colId: string, rowId: number) => {
    const data = table.data.get(colId);
    return data !== undefined && outputValue(data, rowId, ctx).kind !== 'absent';
  };
  return rowIds.filter((rowId) =>
    pairs.some(([parent, inner]) => present(parent, rowId) && inner.some((c) => present(c, rowId))),
  );
}

/** Gera o JSON das linhas e colunas pedidas, na ordem dada. */
export function writeJson(
  table: Table,
  rowIds: readonly number[],
  colIds: readonly string[],
  options: JsonOptions,
): JsonResult {
  const columns = colIds
    .map((id) => table.columns.find((c) => c.id === id))
    .filter((c) => c !== undefined);
  const ctx: OutContext = { format: 'json', stats: { longNumbers: 0 } };
  const ind = options.indent;
  const sep = ind ? ': ' : ':';
  const items: string[] = [];

  if (options.shape === 'arrays') {
    // Primeira linha: os nomes das colunas. Ausente vira null (o diálogo avisa).
    items.push(`[${columns.map((c) => str(c.name)).join(ind ? ', ' : ',')}]`);
    for (const rowId of rowIds) {
      const cells = columns.map((c) => {
        const data = table.data.get(c.id);
        return data ? valueText(outputValue(data, rowId, ctx)) : 'null';
      });
      items.push(`[${cells.join(ind ? ', ' : ',')}]`);
    }
  } else {
    const tree = buildTree(columns, options.nested);
    const render = (nodes: KeyNode[], rowId: number, level: number): string | undefined => {
      const entries: string[] = [];
      for (const node of nodes) {
        let text: string | undefined;
        if (node.colId !== undefined && node.children.length === 0) {
          const data = table.data.get(node.colId);
          const out = data ? outputValue(data, rowId, ctx) : { kind: 'absent' as const };
          // Ausente: a chave é omitida (seção 10.2).
          text = out.kind === 'absent' ? undefined : valueText(out);
        } else {
          // Conflito (L20) já foi barrado antes; aqui o objeto interno vale.
          text = render(node.children, rowId, level + 1);
        }
        if (text !== undefined) entries.push(`${str(node.key)}${sep}${text}`);
      }
      if (entries.length === 0) return level === 1 ? '{}' : undefined;
      return `{${entries.map((e) => pad(level + 1, ind) + e).join(',')}${pad(level, ind)}}`;
    };
    for (const rowId of rowIds) items.push(render(tree, rowId, 1) ?? '{}');
  }
  const body =
    items.length === 0 ? '[]' : `[${items.map((i) => pad(1, ind) + i).join(',')}${pad(0, ind)}]`;
  return { text: `${body}\n` };
}
