import { type PipeTransform, Injectable } from '@nestjs/common';
import { type ZodSchema, type ZodError } from 'zod';

import { ValidationError } from './errors.js';

/**
 * ZodValidationPipe — validates input against a Zod schema.
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
   * @returns The parsed and transformed data
   * @throws ValidationError when validation fails
   */
  transform(value: unknown): unknown {
    const result = this.schema.safeParse(value);

    if (!result.success) {
      const issues = (result.error as ZodError).issues.map(
        (issue: { path: (string | number)[]; code: string; message: string }) => ({
          path: issue.path.join('.'),
          code: issue.code,
          message: issue.message,
        }),
      );

      throw new ValidationError('VALIDATION_ERROR', 'Input validation failed', {
        issues,
      });
    }

    return result.data;
  }
}
