/** Domain errors. Route handlers map these to HTTP responses. */
export { ForbiddenError } from "./rbac/actor";

export class NotFoundError extends Error {
  readonly status = 404;
  constructor(what = "Resource") {
    super(`${what} not found`);
    this.name = "NotFoundError";
  }
}

export class ValidationError extends Error {
  readonly status = 400;
  constructor(
    message: string,
    public readonly fields: Record<string, string> = {},
  ) {
    super(message);
    this.name = "ValidationError";
  }
}

export class ConflictError extends Error {
  readonly status = 409;
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}
