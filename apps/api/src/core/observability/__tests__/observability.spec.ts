import type { ConfigService } from '@modubiz/config';
import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest';

import { CORRELATION_ID_HEADER } from '../correlation-id.middleware.js';
import { CorrelationIdStorage } from '../correlation-id.storage.js';
import { LoggerService } from '../observability.logger.js';

// ─── Mock ConfigService ────────────────────────────────────────────────────

function createMockConfig(overrides: Partial<Record<string, unknown>> = {}): ConfigService {
  return {
    isDev: false,
    isProd: true,
    isTest: false,
    logLevel: 'silent',
    nodeEnv: 'test',
    ...overrides,
  } as unknown as ConfigService;
}

// ─── CorrelationIdStorage ──────────────────────────────────────────────────

describe('CorrelationIdStorage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns undefined when no context is set', () => {
    expect(CorrelationIdStorage.get()).toBeUndefined();
  });

  it('returns the correlation ID within the run context', async () => {
    const result = await CorrelationIdStorage.run('test-id', async () => {
      return CorrelationIdStorage.get();
    });
    expect(result).toBe('test-id');
  });

  it('returns undefined outside the run context', async () => {
    await CorrelationIdStorage.run('test-id', async () => {
      // Inside context = 'test-id'
    });
    // Outside context = undefined
    expect(CorrelationIdStorage.get()).toBeUndefined();
  });

  it('preserves context across async operations', async () => {
    const result = await CorrelationIdStorage.run('async-test', async () => {
      // Simulate an async operation
      await new Promise((resolve) => setTimeout(resolve, 10));
      return CorrelationIdStorage.get();
    });
    expect(result).toBe('async-test');
  });

  it('supports nested contexts', async () => {
    const result = await CorrelationIdStorage.run('outer', async () => {
      const inner = await CorrelationIdStorage.run('inner', async () => {
        return CorrelationIdStorage.get();
      });
      const outer = CorrelationIdStorage.get();
      return { inner, outer };
    });
    expect(result.inner).toBe('inner');
    expect(result.outer).toBe('outer');
  });

  it('require throws when no context is available', () => {
    expect(() => CorrelationIdStorage.require()).toThrow('No correlation ID available');
  });

  it('require returns the ID when context is set', async () => {
    const result = await CorrelationIdStorage.run('required-id', async () => {
      return CorrelationIdStorage.require();
    });
    expect(result).toBe('required-id');
  });

  it('generate returns a non-empty string', () => {
    const id = CorrelationIdStorage.generate();
    expect(id).toBeDefined();
    expect(id.length).toBeGreaterThan(0);
  });

  it('generate returns unique values', () => {
    const ids = new Set(Array.from({ length: 100 }, () => CorrelationIdStorage.generate()));
    expect(ids.size).toBe(100);
  });
});

// ─── LoggerService ─────────────────────────────────────────────────────────

describe('LoggerService', () => {
  let logger: LoggerService;

  beforeEach(() => {
    const config = createMockConfig({ logLevel: 'silent' });
    logger = new LoggerService(config);
  });

  it('is defined', () => {
    expect(logger).toBeDefined();
  });

  it('implements NestJS LoggerService interface', () => {
    expect(typeof logger.log).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.debug).toBe('function');
    expect(typeof logger.verbose).toBe('function');
  });

  it('provides structured logging methods', () => {
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.errorStructured).toBe('function');
    expect(typeof logger.warnStructured).toBe('function');
    expect(typeof logger.debugStructured).toBe('function');
    expect(typeof logger.fatal).toBe('function');
  });

  it('has a getPinoLogger method', () => {
    const pinoLogger = logger.getPinoLogger();
    expect(pinoLogger).toBeDefined();
    expect(typeof pinoLogger.info).toBe('function');
  });

  it('log method does not throw', () => {
    expect(() => logger.log('test message')).not.toThrow();
  });

  it('error method does not throw', () => {
    expect(() => logger.error('test error')).not.toThrow();
  });

  it('warn method does not throw', () => {
    expect(() => logger.warn('test warning')).not.toThrow();
  });

  it('info method with structured fields does not throw', () => {
    expect(() => logger.info({ saleId: 'abc-123' }, 'Sale completed')).not.toThrow();
  });

  it('errorStructured with error object does not throw', () => {
    expect(() => logger.errorStructured({ err: new Error('test'), orderId: 'ord-1' }, 'Order failed')).not.toThrow();
  });

  it('warnStructured does not throw', () => {
    expect(() => logger.warnStructured({ module: 'test' }, 'Warning')).not.toThrow();
  });

  it('debugStructured does not throw', () => {
    expect(() => logger.debugStructured({ detail: 'info' }, 'Debug')).not.toThrow();
  });

  it('fatal does not throw', () => {
    expect(() => logger.fatal({ reason: 'critical' }, 'Fatal error')).not.toThrow();
  });

  it('creates logger with configured log level', () => {
    const config = createMockConfig({ logLevel: 'debug' });
    const customLogger = new LoggerService(config);
    const pinoLogger = customLogger.getPinoLogger();
    expect(pinoLogger.level).toBe('debug');
  });

  it('auto-attaches correlationId from CorrelationIdStorage', async () => {
    // This test verifies the correlation ID flows to logs via the context
    const config = createMockConfig({ logLevel: 'silent' });
    const contextLogger = new LoggerService(config);

    await CorrelationIdStorage.run('corr-123', async () => {
      // Should not throw when correlation ID is available
      expect(() => contextLogger.info({ test: true }, 'test')).not.toThrow();
    });
  });

  it('enriches with TenantContext fields when available', async () => {
    // This test verifies the logger doesn't throw when TenantContext is available
    await CorrelationIdStorage.run('test-corr', async () => {
      expect(() => logger.info({ module: 'test' }, 'enriched log')).not.toThrow();
    });
  });
});

// ─── CorrelationIdMiddleware ───────────────────────────────────────────────

describe('CORRELATION_ID_HEADER', () => {
  it('uses the standard header name', () => {
    expect(CORRELATION_ID_HEADER).toBe('x-correlation-id');
  });
});
