import zlib from 'node:zlib';
import { ImportError, LIMITS, formatInteger } from '@datakit/core';

// Proteção contra zip bomb (seção 12), antes de entregar o arquivo ao ExcelJS:
// 1. lê o diretório central e confere número de entradas e tamanho total declarado;
// 2. descompacta de verdade com teto de saída, porque o tamanho declarado pode mentir.

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const U16_MAX = 0xffff;
const U32_MAX = 0xffffffff;

export type ZipEntry = {
  name: string;
  method: number;
  flags: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
};

const corrupt = (): never => {
  throw new ImportError('INVALID_FILE', 'O arquivo XLSX está corrompido ou incompleto.');
};

const tooBig = (detail: string): never => {
  throw new ImportError(
    'ZIP_LIMITS',
    `O arquivo XLSX passa dos limites de segurança (${detail}). Ele não foi aberto.`,
  );
};

export function readZipDirectory(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const minEocd = Math.max(0, bytes.length - (22 + U16_MAX));
  let eocd = -1;
  for (let i = bytes.length - 22; i >= minEocd; i -= 1) {
    if (view.getUint32(i, true) === EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) corrupt();

  const totalEntries = view.getUint16(eocd + 10, true);
  const directoryOffset = view.getUint32(eocd + 16, true);
  // ZIP64 só aparece acima de 65.535 entradas ou 4 GB: muito além dos limites.
  if (totalEntries === U16_MAX || directoryOffset === U32_MAX) {
    tooBig('formato ZIP64');
  }
  if (totalEntries > LIMITS.xlsxMaxZipEntries) {
    tooBig(
      `${formatInteger(totalEntries)} entradas; o limite é ${formatInteger(LIMITS.xlsxMaxZipEntries)}`,
    );
  }

  const entries: ZipEntry[] = [];
  let declaredTotal = 0;
  let p = directoryOffset;
  for (let n = 0; n < totalEntries; n += 1) {
    if (p + 46 > bytes.length || view.getUint32(p, true) !== CENTRAL_SIGNATURE) corrupt();
    const nameLength = view.getUint16(p + 28, true);
    const extraLength = view.getUint16(p + 30, true);
    const commentLength = view.getUint16(p + 32, true);
    const entry: ZipEntry = {
      flags: view.getUint16(p + 8, true),
      method: view.getUint16(p + 10, true),
      compressedSize: view.getUint32(p + 20, true),
      uncompressedSize: view.getUint32(p + 24, true),
      localHeaderOffset: view.getUint32(p + 42, true),
      name: new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLength)),
    };
    if (entry.uncompressedSize === U32_MAX || entry.compressedSize === U32_MAX) {
      tooBig('formato ZIP64');
    }
    declaredTotal += entry.uncompressedSize;
    if (declaredTotal > LIMITS.xlsxMaxUncompressedBytes) {
      tooBig(
        `mais de ${formatInteger(LIMITS.xlsxMaxUncompressedBytes / 1024 / 1024)} MB descompactado`,
      );
    }
    entries.push(entry);
    p += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** Descompacta cada entrada com teto de saída e confere o tamanho declarado. */
export function verifyZipContents(bytes: Uint8Array, entries: readonly ZipEntry[]): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let remaining = LIMITS.xlsxMaxUncompressedBytes;
  for (const entry of entries) {
    if (entry.flags & 0x1) {
      throw new ImportError(
        'INVALID_FILE',
        'A planilha está protegida por senha e não pode ser aberta.',
      );
    }
    const p = entry.localHeaderOffset;
    if (p + 30 > bytes.length || view.getUint32(p, true) !== LOCAL_SIGNATURE) corrupt();
    const start = p + 30 + view.getUint16(p + 26, true) + view.getUint16(p + 28, true);
    const end = start + entry.compressedSize;
    if (end > bytes.length) corrupt();
    const data = bytes.subarray(start, end);

    let size: number;
    if (entry.method === 0) {
      size = data.length;
    } else if (entry.method === 8) {
      try {
        size = zlib.inflateRawSync(data, { maxOutputLength: remaining + 1 }).length;
      } catch (err) {
        if (
          err instanceof RangeError ||
          (err as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE'
        ) {
          return tooBig('conteúdo descompactado maior que o declarado');
        }
        return corrupt();
      }
    } else {
      return corrupt();
    }
    if (size > remaining) tooBig('conteúdo descompactado maior que o permitido');
    if (size !== entry.uncompressedSize) {
      tooBig('tamanho descompactado diferente do declarado');
    }
    remaining -= size;
  }
}

/** Assinatura de arquivo OLE: .xls antigo ou XLSX protegido por senha. */
export function isOleFile(bytes: Uint8Array): boolean {
  const sig = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  return sig.every((b, i) => bytes[i] === b);
}
