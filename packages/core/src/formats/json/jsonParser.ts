// Leitor JSON próprio (docs/PLANO.md, L1). Diferenças em relação ao JSON.parse:
// - preserva a ordem das chaves, inclusive numéricas ("10", "2"), que o JSON.parse moveria para a frente;
// - mantém chaves repetidas (o JSON.parse descarta todas menos a última, sem avisar);
// - guarda o texto exato de cada número (inteiros acima de 2^53 não perdem dígitos);
// - nunca cria objetos JS com chaves do usuário (sem risco de prototype pollution);
// - limita a profundidade e informa linha e coluna exatas dos erros, em qualquer navegador.

import { ImportError } from '../../errors.ts';

export class JsonNumber {
  readonly raw: string;
  constructor(raw: string) {
    this.raw = raw;
  }
}

export class JsonObject {
  readonly keys: string[] = [];
  readonly values: JsonValue[] = [];
}

export type JsonValue = string | boolean | null | JsonNumber | JsonObject | JsonValue[];

const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;

const SPACE = 0x20;
const TAB = 0x09;
const LF = 0x0a;
const CR = 0x0d;
const QUOTE = 0x22;
const BACKSLASH = 0x5c;

export function lineAndColumn(text: string, index: number): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < index && i < text.length; i += 1) {
    if (text.charCodeAt(i) === LF) {
      line += 1;
      lineStart = i + 1;
    }
  }
  return { line, column: index - lineStart + 1 };
}

function describe(text: string, index: number): string {
  if (index >= text.length) return 'fim do arquivo';
  const ch = text[index] ?? '';
  return ch.trim() === '' ? `caractere invisível (código ${ch.charCodeAt(0)})` : `"${ch}"`;
}

export function parseJson(text: string, maxDepth: number): JsonValue {
  let i = 0;

  const fail = (message: string, at = i): never => {
    const { line, column } = lineAndColumn(text, at);
    throw new ImportError(
      'INVALID_FILE',
      `JSON inválido na linha ${line}, coluna ${column}: ${message}.`,
      {
        line,
        column,
      },
    );
  };

  const skipWhitespace = (): void => {
    for (;;) {
      const c = text.charCodeAt(i);
      if (c === SPACE || c === TAB || c === LF || c === CR) i += 1;
      else return;
    }
  };

  const expectLiteral = (word: string): void => {
    if (text.startsWith(word, i)) i += word.length;
    else fail(`valor inesperado ${describe(text, i)}`);
  };

  const parseString = (): string => {
    const start = i;
    i += 1;
    let escaped = false;
    for (;;) {
      if (i >= text.length) fail('texto sem aspas de fechamento', start);
      const c = text.charCodeAt(i);
      if (c === QUOTE) break;
      if (c < 0x20) fail('caractere de controle sem escape dentro de um texto');
      if (c === BACKSLASH) {
        escaped = true;
        const next = text[i + 1];
        if (next === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6))) fail('escape \\u inválido');
          i += 6;
          continue;
        }
        if (next === undefined || !'"\\/bfnrt'.includes(next)) fail('escape inválido');
        i += 2;
        continue;
      }
      i += 1;
    }
    i += 1;
    // Sem escapes, o texto é o próprio trecho; com escapes, o JSON.parse decodifica só a string.
    return escaped ? (JSON.parse(text.slice(start, i)) as string) : text.slice(start + 1, i - 1);
  };

  const parseValue = (depth: number): JsonValue => {
    skipWhitespace();
    const c = text[i];
    switch (c) {
      case '{':
        return parseObject(depth + 1);
      case '[':
        return parseArray(depth + 1);
      case '"':
        return parseString();
      case 't':
        expectLiteral('true');
        return true;
      case 'f':
        expectLiteral('false');
        return false;
      case 'n':
        expectLiteral('null');
        return null;
      default: {
        NUMBER.lastIndex = i;
        const m = NUMBER.exec(text);
        if (!m) return fail(`valor inesperado ${describe(text, i)}`);
        i += m[0].length;
        return new JsonNumber(m[0]);
      }
    }
  };

  const checkDepth = (depth: number): void => {
    if (depth > maxDepth) fail(`aninhamento acima do limite de ${maxDepth} níveis`);
  };

  const parseObject = (depth: number): JsonObject => {
    checkDepth(depth);
    const obj = new JsonObject();
    i += 1;
    skipWhitespace();
    if (text[i] === '}') {
      i += 1;
      return obj;
    }
    for (;;) {
      skipWhitespace();
      if (text[i] !== '"')
        fail(`esperado o nome de uma chave entre aspas, encontrado ${describe(text, i)}`);
      obj.keys.push(parseString());
      skipWhitespace();
      if (text[i] !== ':') fail(`esperado ":" depois da chave, encontrado ${describe(text, i)}`);
      i += 1;
      obj.values.push(parseValue(depth));
      skipWhitespace();
      if (text[i] === ',') {
        i += 1;
        continue;
      }
      if (text[i] === '}') {
        i += 1;
        return obj;
      }
      return fail(`esperado "," ou "}", encontrado ${describe(text, i)}`);
    }
  };

  const parseArray = (depth: number): JsonValue[] => {
    checkDepth(depth);
    const items: JsonValue[] = [];
    i += 1;
    skipWhitespace();
    if (text[i] === ']') {
      i += 1;
      return items;
    }
    for (;;) {
      items.push(parseValue(depth));
      skipWhitespace();
      if (text[i] === ',') {
        i += 1;
        continue;
      }
      if (text[i] === ']') {
        i += 1;
        return items;
      }
      return fail(`esperado "," ou "]", encontrado ${describe(text, i)}`);
    }
  };

  skipWhitespace();
  if (i >= text.length) fail('o arquivo está vazio');
  const root = parseValue(0);
  skipWhitespace();
  if (i < text.length) fail(`conteúdo extra depois do fim do JSON: ${describe(text, i)}`);
  return root;
}

/** JSON compacto de um valor, com os números no texto original (para células do tipo "json"). */
export function stringifyJson(value: JsonValue): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value instanceof JsonNumber) return value.raw;
  if (Array.isArray(value)) return `[${value.map(stringifyJson).join(',')}]`;
  const parts = value.keys.map(
    (key, k) => `${JSON.stringify(key)}:${stringifyJson(value.values[k] ?? null)}`,
  );
  return `{${parts.join(',')}}`;
}
