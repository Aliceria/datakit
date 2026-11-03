import { ImportError } from '../errors.ts';
import type { FormatId } from '../model/document.ts';
import { SUPPORTED_EXTENSIONS } from '../params.ts';

export type ContentKind = 'zip' | 'binary' | 'text';

/** O que o conteúdo parece ser, olhando os primeiros bytes. */
export function sniffContent(bytes: Uint8Array): ContentKind {
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    return 'zip';
  }
  const end = Math.min(bytes.length, 64 * 1024);
  for (let i = 0; i < end; i += 1) {
    if (bytes[i] === 0) return 'binary';
  }
  return 'text';
}

export function fileExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot < 0 ? '' : fileName.slice(dot).toLowerCase();
}

/** Primeiro passo da validação (seção 6.1): extensão permitida. */
export function formatFromFileName(fileName: string): FormatId {
  const ext = fileExtension(fileName);
  if (!(SUPPORTED_EXTENSIONS as readonly string[]).includes(ext)) {
    const shown = ext === '' ? 'sem extensão' : ext;
    throw new ImportError(
      'UNSUPPORTED_FORMAT',
      `Formato não suportado (${shown}). O DataKit abre arquivos .csv, .xlsx e .json.`,
    );
  }
  return ext.slice(1) as FormatId;
}

const KIND_LABEL: Record<ContentKind, string> = {
  zip: 'um arquivo compactado (ZIP), como uma planilha XLSX',
  binary: 'um arquivo binário, não texto',
  text: 'texto',
};

/** Extensão e conteúdo precisam concordar (seção 6.1). */
export function assertContentMatches(format: FormatId, bytes: Uint8Array): void {
  const kind = sniffContent(bytes);
  const expected: ContentKind = format === 'xlsx' ? 'zip' : 'text';
  if (kind !== expected) {
    throw new ImportError(
      'EXTENSION_MISMATCH',
      `O arquivo tem extensão .${format}, mas o conteúdo é ${KIND_LABEL[kind]}. ` +
        'Confira se a extensão está correta.',
    );
  }
}
