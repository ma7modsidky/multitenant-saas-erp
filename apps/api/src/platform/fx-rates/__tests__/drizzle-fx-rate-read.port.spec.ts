import { describe, expect, it, vi } from 'vitest';

import type { TransactionManager } from '../../../core/database/transaction-manager.js';
import type { FxRatesRepository } from '../ports/index.js';
import { DrizzleFxRateReadPort } from '../infrastructure/read-ports/drizzle-fx-rate-read.port.js';

function makeTxManager(): TransactionManager {
  const tx = { __ambient: true };
  return {
    run: vi.fn(async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(tx)),
    ref: vi.fn(),
  } as unknown as TransactionManager;
}

function makeRepo(rate: { rate: string; validOn: string; source: string } | undefined) {
  return {
    getLatestRate: vi.fn().mockResolvedValue(rate),
  } as unknown as FxRatesRepository;
}

describe('DrizzleFxRateReadPort — getRate (CRM-8)', () => {
  it('CRM-8: returns the latest rate as a plain snapshot with Date validOn', async () => {
    const repo = makeRepo({ rate: '1.100000', validOn: '2026-01-15', source: 'mock' });
    const port = new DrizzleFxRateReadPort(repo, makeTxManager());

    const rate = await port.getRate('EUR', 'USD');

    expect(rate).toEqual({
      rate: 1.1,
      source: 'mock',
      validOn: new Date('2026-01-15'),
    });
    expect(repo.getLatestRate).toHaveBeenCalledWith('EUR', 'USD', expect.anything());
  });

  it('returns undefined when no snapshot exists (domain decides DEAL_FX_RATE_REQUIRED)', async () => {
    const repo = makeRepo(undefined);
    const port = new DrizzleFxRateReadPort(repo, makeTxManager());

    const rate = await port.getRate('JPY', 'USD');

    expect(rate).toBeUndefined();
  });
});
