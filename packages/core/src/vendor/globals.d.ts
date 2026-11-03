// APIs que existem igualmente no navegador e no Node e que o core usa.
// Declaradas aqui porque o core compila sem os tipos do DOM e do Node.

interface TextDecoderOptions {
  fatal?: boolean;
  ignoreBOM?: boolean;
}

declare class TextDecoder {
  constructor(label?: string, options?: TextDecoderOptions);
  readonly encoding: string;
  decode(input?: Uint8Array): string;
}

declare class TextEncoder {
  encode(input?: string): Uint8Array;
}
