import { fileExtension } from '../detect/format.ts';
import type { FormatDescriptor, FormatReader } from './types.ts';

export const CSV_FORMAT: FormatDescriptor = {
  id: 'csv',
  label: 'CSV',
  extensions: ['.csv'],
  preview: 'client',
};
export const XLSX_FORMAT: FormatDescriptor = {
  id: 'xlsx',
  label: 'XLSX',
  extensions: ['.xlsx'],
  preview: 'server',
};
export const JSON_FORMAT: FormatDescriptor = {
  id: 'json',
  label: 'JSON',
  extensions: ['.json'],
  preview: 'client',
};

/** Descritores dos três formatos. A interface só conhece estes dados, nunca os leitores. */
export const FORMAT_DESCRIPTORS: readonly FormatDescriptor[] = [
  CSV_FORMAT,
  XLSX_FORMAT,
  JSON_FORMAT,
];

export function descriptorForFileName(fileName: string): FormatDescriptor | undefined {
  const ext = fileExtension(fileName);
  return FORMAT_DESCRIPTORS.find((d) => d.extensions.includes(ext));
}

export type FormatRegistry = {
  get(id: string): FormatReader | undefined;
  forFileName(fileName: string): FormatReader | undefined;
};

/** Cada lado registra os leitores que tem: o navegador CSV e JSON; o servidor também XLSX. */
export function createFormatRegistry(readers: readonly FormatReader[]): FormatRegistry {
  const byId = new Map(readers.map((r) => [r.descriptor.id as string, r]));
  return {
    get: (id) => byId.get(id),
    forFileName: (fileName) => {
      const ext = fileExtension(fileName);
      return readers.find((r) => r.descriptor.extensions.includes(ext));
    },
  };
}
