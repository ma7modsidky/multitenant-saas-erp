import { type PipeTransform, Injectable, type ArgumentMetadata } from '@nestjs/common';
import { type ZodSchema, type ZodError } from 'zod';

import { ValidationError } from './errors.js';

/**
 * ZodValidationPipe — validates the request BODY against a Zod schema.
 *
 * Usage in controllers:
 * ```typescript
 * @Post()
 * async create(
 *   @Body(new ZodValidationPipe(createProductSchema))
 *   data: CreateProduct,
 * ) { ... }
 * ```
 *
 * When bound at handler level via @UsePipes(), NestJS runs the pipe against
 * EVERY parameter of the handler (body, path params, query). The pipe only
 * validates the body and passes other parameter types through unchanged,
 * otherwise an object schema would reject a string @Param with
 * "Expected object, received string".
 *
 * On validation failure, throws a ValidationError (400) with structured
 * issue details that the global exception filter maps to the standard
 * error response format.
 *
 * @see CODING_STANDARDS.md §5 — Validation
 * @see AppExceptionFilter — catches ValidationError
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}

  /**
   * Validate and transform the input value.
   *
   * @param value - The raw input to validate
   * @param metadata - Parameter metadata; only 'body' is validated
   * @returns The parsed and transformed data
   * @throws ValidationError when validation fails
   */
  transform(value: unknown, metadata?: ArgumentMetadata): unknown {
    // Handler-level @UsePipes() applies this pipe to every parameter of the
    // route handler. Only the request body is described by the Zod schema;
    // path params, query strings, and custom params must pass through
    // untouched (validating a string @Param against an object schema would
    // 400 every request to the endpoint). When called directly (no metadata,
    // e.g. unit tests), the value IS the body and is validated.
    if (metadata !== undefined && metadata.type !== 'body') {
      return value;
    }

    const result = this.schema.safeParse(value);

    if (!result.success) {
      const issues = result.error.issues.map((issue: { path: (string | number)[]; code: string; message: string }) => ({
        path: issue.path.join('.'),
        code: issue.code,
        message: issue.message,
      }));

      throw new ValidationError('VALIDATION_ERROR', 'Input validation failed', {
        issues,
      });
    }

    return result.data;
  }
}
