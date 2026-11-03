// Texto separado por tabulação, como o Excel e o Google Planilhas usam na área de transferência
// (seção 7.2). Campos com tabulação, quebra de linha ou aspas vão entre aspas, com "" para aspas.

const NEEDS_QUOTES = /[\t\r\n"]/;

export function toTsv(rows: readonly (readonly string[])[]): string {
  return rows
    .map((row) =>
      row
        .map((field) => (NEEDS_QUOTES.test(field) ? `"${field.replaceAll('"', '""')}"` : field))
        .join('\t'),
    )
    .join('\r\n');
}

/** Lê TSV. A quebra de linha final, que o Excel sempre acrescenta, não vira uma linha vazia. */
export function parseTsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let i = 0;
  let quotedAtStart = false;

  const endField = () => {
    row.push(field);
    field = '';
    quotedAtStart = false;
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const ch = text[i];
    if (field === '' && !quotedAtStart && ch === '"') {
      // Campo entre aspas: vai até a aspa de fechamento (aspas duplas viram uma).
      quotedAtStart = true;
      i += 1;
      let closed = false;
      while (i < text.length) {
        if (text[i] === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i += 2;
            continue;
          }
          i += 1;
          closed = true;
          break;
        }
        field += text.charAt(i);
        i += 1;
      }
      if (!closed) {
        // Aspas sem fechamento: o texto é literal, como estava.
        field = `"${field}`;
      }
      continue;
    }
    if (ch === '\t') {
      endField();
      i += 1;
    } else if (ch === '\r' || ch === '\n') {
      endRow();
      i += ch === '\r' && text[i + 1] === '\n' ? 2 : 1;
    } else {
      field += ch ?? '';
      i += 1;
    }
  }
  if (field !== '' || row.length > 0 || quotedAtStart) endRow();
  return rows;
}
