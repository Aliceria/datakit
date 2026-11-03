// Declaração mínima do PapaParse, só com o que o core usa.
// O @types/papaparse puxa os tipos do Node, e o core não pode depender deles.
declare module 'papaparse' {
  export type ParseError = {
    type: 'Quotes' | 'Delimiter' | 'FieldMismatch';
    code:
      | 'MissingQuotes'
      | 'InvalidQuotes'
      | 'UndetectableDelimiter'
      | 'TooFewFields'
      | 'TooManyFields';
    message: string;
    row?: number;
  };

  export type ParseConfig = {
    delimiter?: string;
    newline?: '' | '\r' | '\n' | '\r\n';
    quoteChar?: string;
    escapeChar?: string;
    header?: false;
    dynamicTyping?: false;
    preview?: number;
    skipEmptyLines?: boolean;
  };

  export type ParseResult = {
    data: string[][];
    errors: ParseError[];
    meta: { delimiter: string; linebreak: string; aborted: boolean; truncated: boolean };
  };

  const Papa: {
    parse(input: string, config: ParseConfig): ParseResult;
  };
  export default Papa;
}
