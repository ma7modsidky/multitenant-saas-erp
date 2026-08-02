/**
 * AppError — base class for all typed application errors.
 *
 * Every error carries a stable, machine-readable code and an HTTP status.
 * The global exception filter maps these to the standard error response format.
 *
 * @see CODING_STANDARDS.md §7 — Error model
 */
export abstract class AppError extends Error {
  /** Stable, machine-readable error code (e.g. 'INV_INSUFFICIENT_STOCK') */
  abstract readonly code: string;
  /** HTTP status code */
  abstract readonly httpStatus: number;

  constructor(
    message?: string,
    readonly params: Record<string, unknown> | undefined = undefined,
  ) {
    super(message ?? 'Application error');
    this.name = this.constructor.name;
  }
}

/**
 * DomainError — a business rule violation (422).
 *
 * Thrown when a domain invariant is violated during a use case execution.
 * Example: attempting to close a shift with unsettled sales.
 *
 * @see ERR-1 — API returns codes, not sentences
 */
export class DomainError extends AppError {
  override readonly httpStatus = 422;

  constructor(
    override readonly code: string,
    message?: string,
    params?: Record<string, unknown>,
  ) {
    super(message ?? code, params);
  }
}

/**
 * NotFoundError — entity not found (404).
 *
 * Thrown when a requested resource does not exist or the user
 * does not have access to it (we don't distinguish which to
 * avoid information leakage).
 */
export class NotFoundError extends AppError {
  override readonly httpStatus = 404;
  override readonly code = 'NOT_FOUND';

  constructor(message?: string, params?: Record<string, unknown>) {
    super(message ?? 'Resource not found', params);
  }
}

/**
 * ConflictError — duplicate or state conflict (409).
 *
 * Thrown when an operation conflicts with the current state:
 *   - Duplicate email, SKU, or idempotency key
 *   - Version conflict on optimistic lock
 *   - Attempting to delete a resource that has dependent records
 */
export class ConflictError extends AppError {
  override readonly httpStatus = 409;

  constructor(
    override readonly code: string,
    message?: string,
    params?: Record<string, unknown>,
  ) {
    super(message ?? code, params);
  }
}

/**
 * ForbiddenError — access denied (403).
 *
 * Thrown when the authenticated user is not permitted to perform
 * the requested action. This covers:
 *   - Module not entitled (AUTHZ-6)
 *   - Missing required permission (AUTHZ-5)
 *   - Role-based restrictions
 */
export class ForbiddenError extends AppError {
  override readonly httpStatus = 403;

  constructor(
    override readonly code: string,
    message?: string,
    params?: Record<string, unknown>,
  ) {
    super(message ?? code, params);
  }
}

/**
 * ValidationError — input validation failure (400).
 *
 * Thrown when request data fails validation rules. This includes:
 *   - Zod schema validation failures
 *   - Missing required fields
 *   - Invalid format, out-of-range values
 *   - Unexpected fields (client sent data it shouldn't)
 */
export class ValidationError extends AppError {
  override readonly httpStatus = 400;

  constructor(
    override readonly code: string,
    message?: string,
    params?: Record<string, unknown>,
  ) {
    super(message ?? code, params);
  }
}

/**
 * UnauthorizedError — not authenticated (401).
 *
 * Thrown when a request does not have valid authentication credentials.
 * Distinct from ForbiddenError (403) — the user is not who they claim
 * to be, rather than not having permission.
 */
export class UnauthorizedError extends AppError {
  override readonly httpStatus = 401;
  override readonly code: string;

  constructor(code = 'UNAUTHORIZED', message?: string, params?: Record<string, unknown>) {
    super(message ?? 'Authentication required', params);
    this.code = code;
  }
}
