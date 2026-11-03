import type { ColumnType } from '@datakit/core';

// Nomes dos tipos inferidos na interface (cabeçalho da grade e inspetores).

export const TYPE_BADGE: Record<ColumnType, string> = {
  text: 'abc',
  number: '123',
  date: 'data',
  boolean: 'bool',
  json: 'json',
  mixed: 'misto',
};

export const TYPE_LABEL: Record<ColumnType, string> = {
  text: 'texto',
  number: 'número',
  date: 'data',
  boolean: 'booleano',
  json: 'JSON',
  mixed: 'misto',
};
