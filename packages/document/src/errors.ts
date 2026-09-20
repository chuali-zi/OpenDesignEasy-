export type KernelErrorCode = "invalid" | "conflict" | "locked" | "not_found";

export class KernelError extends Error {
  readonly code: KernelErrorCode;
  readonly target?: string;
  readonly details?: unknown;

  constructor(code: KernelErrorCode, message: string, target?: string, details?: unknown) {
    super(message);
    this.name = "KernelError";
    this.code = code;
    this.target = target;
    this.details = details;
  }
}

export function invalid(message: string, target?: string, details?: unknown): never {
  throw new KernelError("invalid", message, target, details);
}
