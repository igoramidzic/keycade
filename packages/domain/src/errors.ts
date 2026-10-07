export type DomainErrorCode =
  | "NOT_FOUND"
  | "REVISION_CONFLICT"
  | "INVALID_STATE"
  | "INVALID_INPUT"
  | "INVALID_ACCESS_LINK"
  | "RATE_LIMITED"
  | "IDEMPOTENCY_CONFLICT"
  | "SETUP_REQUIRED";

export class DomainError extends Error {
  constructor(
    public readonly code: DomainErrorCode,
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

// A single denial contract conceals whether a private record exists.
export function deny(): never {
  throw new DomainError("NOT_FOUND", 404, "Resource not found.");
}
