import { HttpException, HttpStatus } from '@nestjs/common';
import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest';
import { z } from 'zod';

import { CorrelationIdStorage } from '../../observability/correlation-id.storage.js';
import { AppExceptionFilter } from '../app-exception.filter.js';
import {
  AppError,
  ConflictError,
  DomainError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from '../errors.js';
import { buildPaginationMeta, clampLimit, normalizePagination } from '../pagination.js';
import { formatResponse } from '../response.interceptor.js';
import { ZodValidationPipe } from '../zod-validation.pipe.js';

// ─── Error Classes ─────────────────────────────────────────────────────────

describe('AppError hierarchy', () => {
  describe('DomainError', () => {
    it('creates with code and default message', () => {
      const error = new DomainError('INV_INSUFFICIENT_STOCK');
      expect(error).toBeInstanceOf(AppError);
      expect(error.code).toBe('INV_INSUFFICIENT_STOCK');
      expect(error.httpStatus).toBe(422);
      expect(error.message).toBe('INV_INSUFFICIENT_STOCK');
    });

    it('creates with custom message and params', () => {
      const error = new DomainError('INV_INSUFFICIENT_STOCK', 'Not enough stock', {
        sku: 'ESP-250',
        available: 3,
        requested: 5,
      });
      expect(error.code).toBe('INV_INSUFFICIENT_STOCK');
      expect(error.message).toBe('Not enough stock');
      expect(error.params).toEqual({ sku: 'ESP-250', available: 3, requested: 5 });
    });

    it('is instanceof AppError', () => {
      const error = new DomainError('TEST');
      expect(error instanceof AppError).toBe(true);
      expect(error instanceof Error).toBe(true);
    });
  });

  describe('NotFoundError', () => {
    it('has code NOT_FOUND and status 404', () => {
      const error = new NotFoundError();
      expect(error.code).toBe('NOT_FOUND');
      expect(error.httpStatus).toBe(404);
    });

    it('accepts custom params', () => {
      const error = new NotFoundError('Product not found', { id: '123' });
      expect(error.params).toEqual({ id: '123' });
    });
  });

  describe('ConflictError', () => {
    it('has configurable code and status 409', () => {
      const error = new ConflictError('DUPLICATE_EMAIL');
      expect(error.code).toBe('DUPLICATE_EMAIL');
      expect(error.httpStatus).toBe(409);
    });
  });

  describe('ForbiddenError', () => {
    it('has configurable code and status 403', () => {
      const error = new ForbiddenError('MODULE_NOT_ENTITLED');
      expect(error.code).toBe('MODULE_NOT_ENTITLED');
      expect(error.httpStatus).toBe(403);
    });
  });

  describe('ValidationError', () => {
    it('has configurable code and status 400', () => {
      const error = new ValidationError('INVALID_INPUT');
      expect(error.code).toBe('INVALID_INPUT');
      expect(error.httpStatus).toBe(400);
    });
  });

  describe('UnauthorizedError', () => {
    it('has code UNAUTHORIZED and status 401', () => {
      const error = new UnauthorizedError();
      expect(error.code).toBe('UNAUTHORIZED');
      expect(error.httpStatus).toBe(401);
    });

    it('accepts a configurable error code', () => {
      const error = new UnauthorizedError('AUTH_INVALID_CREDENTIALS');
      expect(error.code).toBe('AUTH_INVALID_CREDENTIALS');
      expect(error.httpStatus).toBe(401);
    });
  });
});

// ─── Pagination ────────────────────────────────────────────────────────────

describe('clampLimit', () => {
  it('returns the limit if within bounds', () => {
    expect(clampLimit(20)).toBe(20);
  });

  it('clamps to max 100 by default', () => {
    expect(clampLimit(200)).toBe(100);
  });

  it('clamps to 1 if limit is 0 or negative', () => {
    expect(clampLimit(0)).toBe(1);
    expect(clampLimit(-5)).toBe(1);
  });

  it('uses a custom max if provided', () => {
    expect(clampLimit(50, 25)).toBe(25);
  });
});

describe('buildPaginationMeta', () => {
  it('computes hasMore correctly with more items', () => {
    const meta = buildPaginationMeta([1, 2, 3, 4, 5], 25, 5, 0);
    expect(meta.total).toBe(25);
    expect(meta.hasMore).toBe(true);
  });

  it('computes hasMore correctly with no more items', () => {
    const meta = buildPaginationMeta([1, 2, 3, 4, 5], 5, 5, 0);
    expect(meta.total).toBe(5);
    expect(meta.hasMore).toBe(false);
  });

  it('computes hasMore correctly for the last page', () => {
    const meta = buildPaginationMeta([1, 2, 3], 23, 10, 20);
    expect(meta.total).toBe(23);
    expect(meta.hasMore).toBe(false);
  });
});

describe('normalizePagination', () => {
  it('provides defaults for empty input', () => {
    const result = normalizePagination({});
    expect(result.limit).toBe(20);
    expect(result.offset).toBe(0);
    expect(result.sortOrder).toBe('asc');
  });

  it('clamps limit to max 100', () => {
    const result = normalizePagination({ limit: 500 });
    expect(result.limit).toBe(100);
  });

  it('clamps limit to min 1', () => {
    const result = normalizePagination({ limit: 0 });
    expect(result.limit).toBe(1);
  });

  it('passes through cursor when provided', () => {
    const result = normalizePagination({ limit: 10, cursor: 'abc123' });
    expect(result.cursor).toBe('abc123');
  });

  it('passes through sortBy when provided', () => {
    const result = normalizePagination({ limit: 10, sortBy: 'name', sortOrder: 'desc' });
    expect(result.sortBy).toBe('name');
    expect(result.sortOrder).toBe('desc');
  });
});

// ─── Exception Filter ─────────────────────────────────────────────────────

describe('AppExceptionFilter', () => {
  let filter: AppExceptionFilter;
  let mockResponse: { status: ReturnType<typeof vi.fn>; send: ReturnType<typeof vi.fn> };
  let mockHost: { switchToHttp: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    filter = new AppExceptionFilter();
    mockResponse = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
    };
    mockHost = {
      switchToHttp: vi.fn().mockReturnValue({
        getResponse: () => mockResponse,
      }),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('ERR-1: maps AppError to code and httpStatus', () => {
    const error = new DomainError('INV_INSUFFICIENT_STOCK', undefined, {
      sku: 'ESP-250',
    });

    filter.catch(error, mockHost as never);

    expect(mockResponse.status).toHaveBeenCalledWith(422);
    expect(mockResponse.send).toHaveBeenCalledWith({
      error: expect.objectContaining({
        code: 'INV_INSUFFICIENT_STOCK',
        params: { sku: 'ESP-250' },
        correlationId: expect.any(String),
      }),
    });
  });

  it('ERR-6: maps unknown errors to 500 INTERNAL_ERROR', () => {
    const error = new Error('Something went wrong');

    filter.catch(error, mockHost as never);

    expect(mockResponse.status).toHaveBeenCalledWith(500);
    expect(mockResponse.send).toHaveBeenCalledWith({
      error: expect.objectContaining({
        code: 'INTERNAL_ERROR',
        correlationId: expect.any(String),
      }),
    });
  });

  it('ERR-5: never leaks stack traces to clients', () => {
    const error = new Error('Database connection failed');

    filter.catch(error, mockHost as never);

    const sent = mockResponse.send.mock.calls[0]?.[0];
    expect(sent.error.stack).toBeUndefined();
    expect(sent.error.message).toBeUndefined();
  });

  it('maps NestJS HttpException string message as error code', () => {
    const error = new HttpException('BAD_REQUEST', HttpStatus.BAD_REQUEST);

    filter.catch(error, mockHost as never);

    expect(mockResponse.status).toHaveBeenCalledWith(400);
    expect(mockResponse.send).toHaveBeenCalledWith({
      error: expect.objectContaining({
        code: 'BAD_REQUEST',
        correlationId: expect.any(String),
      }),
    });
  });

  it('maps NestJS ForbiddenException with custom code', () => {
    const error = new HttpException('MODULE_NOT_ENTITLED', HttpStatus.FORBIDDEN);

    filter.catch(error, mockHost as never);

    expect(mockResponse.status).toHaveBeenCalledWith(403);
    expect(mockResponse.send).toHaveBeenCalledWith({
      error: expect.objectContaining({
        code: 'MODULE_NOT_ENTITLED',
        correlationId: expect.any(String),
      }),
    });
  });

  it('attaches correlation ID from CorrelationIdStorage', async () => {
    await CorrelationIdStorage.run('test-corr-123', async () => {
      const error = new DomainError('TEST');
      filter.catch(error, mockHost as never);

      const sent = mockResponse.send.mock.calls[0]?.[0];
      expect(sent.error.correlationId).toBe('test-corr-123');
    });
  });

  it('handles ForbiddenError from our hierarchy', () => {
    const error = new ForbiddenError('MODULE_NOT_ENTITLED');

    filter.catch(error, mockHost as never);

    expect(mockResponse.status).toHaveBeenCalledWith(403);
    expect(mockResponse.send).toHaveBeenCalledWith({
      error: expect.objectContaining({
        code: 'MODULE_NOT_ENTITLED',
        correlationId: expect.any(String),
      }),
    });
  });

  it('handles null/undefined gracefully', () => {
    filter.catch(null, mockHost as never);
    expect(mockResponse.status).toHaveBeenCalledWith(500);

    filter.catch(undefined, mockHost as never);
    expect(mockResponse.status).toHaveBeenCalledWith(500);
  });

  it('handles string exceptions gracefully', () => {
    filter.catch('just a string', mockHost as never);
    expect(mockResponse.status).toHaveBeenCalledWith(500);
  });
});

// ─── ResponseInterceptor (formatResponse pure function) ───────────────────

describe('formatResponse', () => {
  it('wraps a plain object in { data }', () => {
    const result = formatResponse({ id: '123', name: 'test' });
    expect(result).toEqual({ data: { id: '123', name: 'test' } });
  });

  it('wraps a string value in { data }', () => {
    const result = formatResponse('hello');
    expect(result).toEqual({ data: 'hello' });
  });

  it('wraps a number value in { data }', () => {
    const result = formatResponse(42);
    expect(result).toEqual({ data: 42 });
  });

  it('wraps a boolean value in { data }', () => {
    const result = formatResponse(true);
    expect(result).toEqual({ data: true });
  });

  it('wraps an array in { data }', () => {
    const items = [{ id: '1' }, { id: '2' }];
    const result = formatResponse(items);
    expect(result).toEqual({ data: items });
  });

  it('passes through { data } format unchanged', () => {
    const preFormatted = { data: { items: [{ id: '1' }] }, meta: { total: 1, hasMore: false } };
    const result = formatResponse(preFormatted);
    expect(result).toEqual(preFormatted);
  });

  it('passes through { data } without meta', () => {
    const preFormatted = { data: { id: '1' } };
    const result = formatResponse(preFormatted);
    expect(result).toEqual(preFormatted);
  });

  it('converts undefined to { data: null }', () => {
    const result = formatResponse(undefined);
    expect(result).toEqual({ data: null });
  });

  it('converts null to { data: null }', () => {
    const result = formatResponse(null);
    expect(result).toEqual({ data: null });
  });

  it('handles empty object', () => {
    const result = formatResponse({});
    expect(result).toEqual({ data: {} });
  });
});

// ─── ZodValidationPipe ────────────────────────────────────────────────────

describe('ZodValidationPipe', () => {
  it('passes valid data through', () => {
    const schema = z.object({ name: z.string(), age: z.number() });
    const pipe = new ZodValidationPipe(schema);

    const result = pipe.transform({ name: 'John', age: 30 });
    expect(result).toEqual({ name: 'John', age: 30 });
  });

  it('transforms coercible values', () => {
    const schema = z.object({
      count: z.coerce.number(),
    });
    const pipe = new ZodValidationPipe(schema);

    const result = pipe.transform({ count: '42' });
    expect(result).toEqual({ count: 42 });
  });

  it('throws ValidationError on invalid data', () => {
    const schema = z.object({ email: z.string().email() });
    const pipe = new ZodValidationPipe(schema);

    expect(() => pipe.transform({ email: 'not-an-email' })).toThrow(ValidationError);
  });

  it('throws ValidationError with VALIDATION_ERROR code', () => {
    const schema = z.object({ name: z.string().min(1) });
    const pipe = new ZodValidationPipe(schema);

    try {
      pipe.transform({ name: '' });
      throw new Error('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).code).toBe('VALIDATION_ERROR');
      expect((error as ValidationError).httpStatus).toBe(400);
      expect((error as ValidationError).params).toBeDefined();
    }
  });

  it('throws on missing required fields', () => {
    const schema = z.object({ required: z.string() });
    const pipe = new ZodValidationPipe(schema);

    expect(() => pipe.transform({})).toThrow(ValidationError);
  });

  it('strips unknown properties by default', () => {
    const schema = z.object({ name: z.string() }).strict();
    const pipe = new ZodValidationPipe(schema);

    expect(() => pipe.transform({ name: 'test', extra: 'should fail' })).toThrow(ValidationError);
  });

  it('provides structured issue details in params', () => {
    const schema = z.object({ age: z.number().min(18) });
    const pipe = new ZodValidationPipe(schema);

    try {
      pipe.transform({ age: 15 });
      throw new Error('Should have thrown');
    } catch (error) {
      const validationError = error as ValidationError;
      expect(validationError.params).toBeDefined();
      const issues = (validationError.params! as { issues: Array<{ path: string; code: string }> }).issues;
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0]!.path).toBe('age');
    }
  });
});
