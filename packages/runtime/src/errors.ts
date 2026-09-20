export type RuntimeErrorCode = 'invalid' | 'conflict' | 'locked' | 'cancelled' | 'busy' | 'not_found';

export class RuntimeError extends Error {
  readonly code: RuntimeErrorCode;
  readonly details?: unknown;

  constructor(code: RuntimeErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'RuntimeError';
    this.code = code;
    this.details = details;
  }
}
