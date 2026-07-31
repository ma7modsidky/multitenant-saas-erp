import { describe, expect, it, vi } from 'vitest';

import { SnapshotFxRatesUseCase } from '../application/snapshot-fx-rates.use-case.js';
import type { FxRatesRepository } from '../ports/index.js';

function createMockRepo(overrides: Partial<FxRatesRepository> = {}): FxRatesRepository {
  return {
    listCurrencies: vi.fn().mockResolvedValue([
      { code: 'USD', exponent: 2, symbol: '$', name: 'US Dollar' },
      { code: 'EUR', exponent: 2, symbol: '€', name: 'Euro' },
    ]),
    getLatestRate: vi.fn().mockResolvedValue(undefined),
    getRateForDate: vi.fn().mockResolvedValue(undefined),
    insertRate: vi.fn().mockResolvedValue(undefined),
    getLatestRatesForBase: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

describe('SnapshotFxRatesUseCase', () => {
  it('generates rate pairs for all currency combinations', async () => {
    const repo = createMockRepo();
    const useCase = new SnapshotFxRatesUseCase(repo);

    const result = await useCase.execute();

    expect(result.source).toBe('mock');
    expect(result.pairsStored).toBe(2);
    // USD→EUR and EUR→USD (2 pairs for 2 currencies)
    expect(repo.insertRate).toHaveBeenCalledTimes(2);
  });

  it('stores each pair with correct base and quote currencies', async () => {
    const repo = createMockRepo();
    const useCase = new SnapshotFxRatesUseCase(repo);

    await useCase.execute();

    expect(repo.insertRate).toHaveBeenCalledWith(
      expect.objectContaining({ baseCurrency: 'USD', quoteCurrency: 'EUR', source: 'mock' }),
    );
    expect(repo.insertRate).toHaveBeenCalledWith(
      expect.objectContaining({ baseCurrency: 'EUR', quoteCurrency: 'USD', source: 'mock' }),
    );
  });

  it('skips pairs where base equals quote', async () => {
    const repo = createMockRepo();
    const useCase = new SnapshotFxRatesUseCase(repo);

    await useCase.execute();

    // USD→USD and EUR→EUR should NOT be stored
    const calls = (repo.insertRate as ReturnType<typeof vi.fn>).mock.calls;
    const selfPairs = calls.filter(
      (call: unknown[]) => (call[0] as { baseCurrency: string; quoteCurrency: string }).baseCurrency === (call[0] as { baseCurrency: string; quoteCurrency: string }).quoteCurrency,
    );
    expect(selfPairs).toHaveLength(0);
  });

  it('returns 0 pairs when fewer than 2 currencies exist', async () => {
    const repo = createMockRepo({
      listCurrencies: vi.fn().mockResolvedValue([
        { code: 'USD', exponent: 2, symbol: '$', name: 'US Dollar' },
      ]),
    });
    const useCase = new SnapshotFxRatesUseCase(repo);

    const result = await useCase.execute();

    expect(result.pairsStored).toBe(0);
    expect(repo.insertRate).not.toHaveBeenCalled();
  });

  it('returns 0 pairs when no currencies exist', async () => {
    const repo = createMockRepo({
      listCurrencies: vi.fn().mockResolvedValue([]),
    });
    const useCase = new SnapshotFxRatesUseCase(repo);

    const result = await useCase.execute();

    expect(result.pairsStored).toBe(0);
    expect(repo.insertRate).not.toHaveBeenCalled();
  });

  it('generates correct number of pairs for 3 currencies', async () => {
    const repo = createMockRepo({
      listCurrencies: vi.fn().mockResolvedValue([
        { code: 'USD', exponent: 2, symbol: '$', name: 'US Dollar' },
        { code: 'EUR', exponent: 2, symbol: '€', name: 'Euro' },
        { code: 'GBP', exponent: 2, symbol: '£', name: 'British Pound' },
      ]),
    });
    const useCase = new SnapshotFxRatesUseCase(repo);

    const result = await useCase.execute();

    // 3 currencies → 3 × 2 = 6 pairs (excluding self-pairs)
    expect(result.pairsStored).toBe(6);
    expect(repo.insertRate).toHaveBeenCalledTimes(6);
  });

  it('marks source as mock', async () => {
    const repo = createMockRepo();
    const useCase = new SnapshotFxRatesUseCase(repo);

    const result = await useCase.execute();

    expect(result.source).toBe('mock');
  });
});
