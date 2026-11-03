import Papa from 'papaparse';
import type { CsvDelimiter } from '../model/document.ts';

/** Em caso de empate vale esta ordem: ";" primeiro, porque o Excel em português usa ";" (seção 6.2). */
export const DELIMITERS: readonly CsvDelimiter[] = [';', ',', '\t', '|'];

export const DELIMITER_LABELS: Record<CsvDelimiter, string> = {
  ';': 'Ponto e vírgula ( ; )',
  ',': 'Vírgula ( , )',
  '\t': 'Tabulação',
  '|': 'Barra vertical ( | )',
};

const SAMPLE_CHARS = 64 * 1024;
const SAMPLE_ROWS = 50;

/**
 * Escolhe o delimitador que divide as primeiras linhas no mesmo número de campos (> 1)
 * com mais consistência. Respeita aspas, porque usa o próprio PapaParse na amostra.
 */
export function detectDelimiter(text: string): CsvDelimiter {
  let sample = text.slice(0, SAMPLE_CHARS);
  // Descarta a última linha da amostra, que pode ter sido cortada no meio.
  if (text.length > SAMPLE_CHARS) {
    const lastBreak = sample.lastIndexOf('\n');
    if (lastBreak > 0) sample = sample.slice(0, lastBreak);
  }

  let best: CsvDelimiter = ',';
  let bestScore = 0;
  for (const delimiter of DELIMITERS) {
    const { data } = Papa.parse(sample, { delimiter, preview: SAMPLE_ROWS, quoteChar: '"' });
    const rows = data.filter((row) => !(row.length === 1 && row[0] === ''));
    if (rows.length === 0) continue;

    const frequency = new Map<number, number>();
    for (const row of rows) frequency.set(row.length, (frequency.get(row.length) ?? 0) + 1);
    let modeFields = 0;
    let modeCount = 0;
    for (const [fields, count] of frequency) {
      if (count > modeCount || (count === modeCount && fields > modeFields)) {
        modeFields = fields;
        modeCount = count;
      }
    }
    if (modeFields <= 1) continue;

    // Consistência pesa mais; número de campos desempata.
    const score = modeCount / rows.length + modeFields / 10_000;
    if (score > bestScore) {
      best = delimiter;
      bestScore = score;
    }
  }
  return best;
}
