/** Erro de importação com mensagem em português, pronta para o usuário. */
export class ImportError extends Error {
  readonly code: ImportErrorCode;
  readonly details: Record<string, string | number> | undefined;

  constructor(code: ImportErrorCode, message: string, details?: Record<string, string | number>) {
    super(message);
    this.name = 'ImportError';
    this.code = code;
    this.details = details;
  }
}

export type ImportErrorCode =
  | 'UNSUPPORTED_FORMAT'
  | 'EXTENSION_MISMATCH'
  | 'FILE_TOO_LARGE'
  | 'INVALID_FILE'
  | 'LIMIT_EXCEEDED'
  | 'ZIP_LIMITS';
