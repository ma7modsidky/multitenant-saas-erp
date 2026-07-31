import { describe, expect, it, vi } from 'vitest';

import { NotFoundError } from '../../../core/common/errors.js';
import type { AppError } from '../../../core/common/errors.js';
import { GetFxRateUseCase } from '../application/get-fx-rate.use-case.js';
import { CURRENCY_NOT_FOUND, FX_RATE_NOT_FOUND } from '../domain/index.js';
import type { FxRatesRepository } from '../ports/index.js';

function createMockRepo(overrides: Partial<FxRatesRepository> = {}): FxRatesRepository {
  return {
    listCurrencies: vi.fn().mockResolvedValue([
      { code: 'USD', exponent: 2, symbol: '$', name: 'US Dollar' },
      { code: 'EUR', exponent: 2, symbol: '€', name: 'Euro' },
      { code: 'GBP', exponent: 2, symbol: '£', name: 'British Pound' },
      { code: 'JPY', exponent: 0, symbol: '¥', name: 'Japanese Yen' },
    ]),
    getLatestRate: vi.fn().mockResolvedValue({ rate: '0.920000', validOn: '2026-01-15', source: 'mock' }),
    getRateForDate: vi.fn().mockResolvedValue(undefined),
    insertRate: vi.fn().mockResolvedValue(undefined),
    getLatestRatesForBase: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

describe('GetFxRateUseCase', () => {
  it('returns the latest rate for a valid currency pair', async () => {
    const repo = createMockRepo();
    const useCase = new GetFxRateUseCase(repo);

    const result = await useCase.execute({ baseCurrency: 'USD', quoteCurrency: 'EUR' });

    expect(result.baseCurrency).toBe('USD');
    expect(result.quoteCurrency).toBe('EUR');
    expect(result.rate).toBe('0.920000');
    expect(result.validOn).toBe('2026-01-15');
    expect(result.source).toBe('mock');
    expect(repo.getLatestRate).toHaveBeenCalledWith('USD', 'EUR');
  });

  it('CUR-6: uses most recent prior snapshot when date is specified', async () => {
    const repo = createMockRepo({
      getRateForDate: vi.fn().mockResolvedValue({ rate: '0.910000', validOn: '2026-01-10', source: 'mock' }),
    });
    const useCase = new GetFxRateUseCase(repo);

    const result = await useCase.execute({ baseCurrency: 'USD', quoteCurrency: 'EUR', date: '2026-01-14' });

    expect(result.rate).toBe('0.910000');
    expect(result.validOn).toBe('2026-01-10');
    expect(repo.getRateForDate).toHaveBeenCalledWith('USD', 'EUR', '2026-01-14');
  });

  it('throws NotFoundError with CURRENCY_NOT_FOUND message for non-existent base currency', async () => {
    const repo = createMockRepo();
    const useCase = new GetFxRateUseCase(repo);

    await expect(
      useCase.execute({ baseCurrency: 'XYZ', quoteCurrency: 'USD' }),
    ).rejects.toThrow(NotFoundError);

    try {
      await useCase.execute({ baseCurrency: 'XYZ', quoteCurrency: 'USD' });
    } catch (error) {
      const appErr = error as AppError;
      expect(appErr.message).toBe(CURRENCY_NOT_FOUND);
      expect(appErr.params).toEqual({ currency: 'XYZ' });
    }
  });

  it('throws NotFoundError with CURRENCY_NOT_FOUND message for non-existent quote currency', async () => {
    const repo = createMockRepo();
    const useCase = new GetFxRateUseCase(repo);

    await expect(
      useCase.execute({ baseCurrency: 'USD', quoteCurrency: 'XYZ' }),
    ).rejects.toThrow(NotFoundError);

    try {
      await useCase.execute({ baseCurrency: 'USD', quoteCurrency: 'XYZ' });
    } catch (error) {
      const appErr = error as AppError;
      expect(appErr.message).toBe(CURRENCY_NOT_FOUND);
      expect(appErr.params).toEqual({ currency: 'XYZ' });
    }
  });

  it('throws NotFoundError when no rate exists', async () => {
    const repo = createMockRepo({
      getLatestRate: vi.fn().mockResolvedValue(undefined),
      getRateForDate: vi.fn().mockResolvedValue(undefined),
    });
    const useCase = new GetFxRateUseCase(repo);

    await expect(
      useCase.execute({ baseCurrency: 'USD', quoteCurrency: 'JPY' }),
    ).rejects.toThrow(NotFoundError);

    try {
      await useCase.execute({ baseCurrency: 'USD', quoteCurrency: 'JPY' });
    } catch (error) {
      const appErr = error as AppError;
      expect(appErr.message).toBe(FX_RATE_NOT_FOUND);
    }
  });

  it('calls getLatestRate when no date is provided', async () => {
    const repo = createMockRepo();
    const useCase = new GetFxRateUseCase(repo);

    await useCase.execute({ baseCurrency: 'GBP', quoteCurrency: 'USD' });

    expect(repo.getLatestRate).toHaveBeenCalledTimes(1);
    expect(repo.getRateForDate).not.toHaveBeenCalled();
  });

  it('calls getRateForDate when date is provided', async () => {
    const repo = createMockRepo({
      getRateForDate: vi.fn().mockResolvedValue({ rate: '1.100000', validOn: '2026-01-10', source: 'mock' }),
    });
    const useCase = new GetFxRateUseCase(repo);

    await useCase.execute({ baseCurrency: 'EUR', quoteCurrency: 'USD', date: '2026-01-10' });

    expect(repo.getRateForDate).toHaveBeenCalledWith('EUR', 'USD', '2026-01-10');
    expect(repo.getLatestRate).not.toHaveBeenCalled();
  });

  it('validates currencies only once per execution', async () => {
    const repo = createMockRepo();
    const useCase = new GetFxRateUseCase(repo);

    await useCase.execute({ baseCurrency: 'USD', quoteCurrency: 'EUR' });

    expect(repo.listCurrencies).toHaveBeenCalledTimes(1);
  });

  it('CUR-6: throws NotFoundError for date-specific rate when no prior snapshot exists', async () => {
    const repo = createMockRepo({
      getRateForDate: vi.fn().mockResolvedValue(undefined),
    });
    const useCase = new GetFxRateUseCase(repo);

    try {
      await useCase.execute({ baseCurrency: 'USD', quoteCurrency: 'EUR', date: '2025-01-01' });
      expect.fail('Expected NotFoundError to be thrown');
    } catch (error) {
      const appErr = error as AppError;
      expect(appErr.message).toBe(FX_RATE_NOT_FOUND);
    }
  });
});
