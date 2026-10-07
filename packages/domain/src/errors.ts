export type DomainErrorCode = "NOT_FOUND" | "REVISION_CONFLICT" | "INVALID_STATE" | "INVALID_INPUT";

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
