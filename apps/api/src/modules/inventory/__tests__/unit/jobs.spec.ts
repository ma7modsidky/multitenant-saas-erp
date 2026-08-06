import { describe, expect, it, vi } from 'vitest';

import { RESERVATION_STATE, type ReservationData } from '../../domain/index.js';
import { LOW_STOCK_ALERT_JOB, LowStockAlertJob } from '../../jobs/low-stock-alert.job.js';
import { RESERVATION_EXPIRY_JOB, ReservationExpiryJob } from '../../jobs/reservation-expiry.job.js';
import { STOCK_RECONCILIATION_JOB, StockReconciliationJob } from '../../jobs/stock-reconciliation.job.js';

const orgId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const variantId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const warehouseId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

interface FakeJobRecord {
  type: string;
  organizationId?: string;
  userId?: string;
}

/** Queue add-options (org/user context) — no `type` field. */
type FakeJobOptions = Omit<FakeJobRecord, 'type'>;

/** A minimal in-memory queue double with the IJobQueue surface. */
function fakeQueue() {
  const jobs = new Map<string, FakeJobRecord>();
  return {
    add: vi.fn(async (type: string, _payload: unknown, opts?: FakeJobOptions) => {
      const id = `job-${jobs.size + 1}`;
      const record: FakeJobRecord = { type };
      if (opts?.organizationId !== undefined) record.organizationId = opts.organizationId;
      if (opts?.userId !== undefined) record.userId = opts.userId;
      jobs.set(id, record);
      return { id };
    }),
    getStatus: vi.fn(async (id: string) => {
      const job = jobs.get(id);
      return job ? { id, ...job, payload: {} } : undefined;
    }),
    complete: vi.fn(async () => {}),
    fail: vi.fn(async () => {}),
  };
}

/** A repo double covering the methods the jobs touch. */
function fakeRepo(overrides: Record<string, unknown> = {}) {
  return {
    listExpiredHeldReservations: vi.fn(async () => [] as ReservationData[]),
    getStockLevel: vi.fn(async () => undefined),
    upsertStockLevel: vi.fn(async () => {}),
    updateReservationState: vi.fn(async () => {}),
    listStockLevels: vi.fn(async () => []),
    upsertLowStockAlert: vi.fn(async () => {}),
    sumMovementsByVariantWarehouse: vi.fn(async () => []),
    ...overrides,
  };
}

function fakeTxManager() {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    run: vi.fn(async <T>(fn: (tx: any) => Promise<T>) => fn({})),
  };
}

function fakeUnitOfWork() {
  return {
    addEvent: vi.fn(),
    publishEvents: vi.fn(async () => {}),
  };
}

describe('ReservationExpiryJob (INV-7)', () => {
  it('schedules a job carrying the organization id (TEN-6)', async () => {
    const queue = fakeQueue();
    const job = new ReservationExpiryJob(queue as never, fakeRepo() as never, fakeTxManager() as never);
    await job.schedule(orgId, 'user-1');
    expect(queue.add).toHaveBeenCalledWith(RESERVATION_EXPIRY_JOB, {}, { organizationId: orgId, userId: 'user-1' });
  });

  it('processes expired held reservations: marks expired and returns quantity to available', async () => {
    const queue = fakeQueue();
    await queue.add(RESERVATION_EXPIRY_JOB, {}, { organizationId: orgId });

    const reservation: ReservationData = {
      id: '11111111-1111-1111-1111-111111111111',
      organizationId: orgId,
      variantId,
      warehouseId,
      quantity: '3',
      state: RESERVATION_STATE.HELD,
      expiresAt: new Date(Date.now() - 1000),
      referenceType: 'pos_sale',
      referenceId: '22222222-2222-2222-2222-222222222222',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const repo = fakeRepo({
      listExpiredHeldReservations: vi.fn(async () => [reservation]),
      getStockLevel: vi.fn(async () => ({
        variantId,
        warehouseId,
        quantityOnHand: '10',
        quantityReserved: '3',
      })),
    });

    const job = new ReservationExpiryJob(queue as never, repo as never, fakeTxManager() as never);
    const result = await job.process('job-1');

    expect(result).toEqual({ expired: 1 });
    expect(repo.upsertStockLevel).toHaveBeenCalledWith(variantId, warehouseId, '10', '0', null, expect.anything());
    expect(repo.updateReservationState).toHaveBeenCalledWith(
      reservation.id,
      RESERVATION_STATE.EXPIRED,
      expect.any(Date),
      expect.anything(),
    );
    expect(queue.complete).toHaveBeenCalledWith('job-1');
  });

  it('fails the job when the payload has no organization id', async () => {
    const queue = fakeQueue();
    await queue.add('other.job', {});
    const job = new ReservationExpiryJob(queue as never, fakeRepo() as never, fakeTxManager() as never);
    const result = await job.process('job-1');
    expect(result).toEqual({ expired: 0 });
    expect(queue.fail).toHaveBeenCalledWith('job-1', 'missing organizationId');
  });
});

describe('LowStockAlertJob (INV-13)', () => {
  it('flags stock below the reorder point using AVAILABLE (INV-5), not on-hand', async () => {
    const queue = fakeQueue();
    await queue.add(LOW_STOCK_ALERT_JOB, {}, { organizationId: orgId });

    const repo = fakeRepo({
      listStockLevels: vi.fn(async () => [
        {
          variantId,
          sku: 'LOW-1',
          nameI18n: { en: 'Low' },
          warehouseId,
          warehouseName: 'Default',
          // on-hand 10 but reserved 8 → available 2 < reorder 5 → alert.
          quantityOnHand: '10',
          quantityReserved: '8',
          reorderPoint: '5',
          lastMovementId: null,
        },
        {
          variantId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
          sku: 'OK-1',
          nameI18n: { en: 'Ok' },
          warehouseId,
          warehouseName: 'Default',
          quantityOnHand: '50',
          quantityReserved: '0',
          reorderPoint: '5',
          lastMovementId: null,
        },
      ]),
    });
    const uow = fakeUnitOfWork();

    const job = new LowStockAlertJob(queue as never, repo as never, fakeTxManager() as never, uow as never);
    const result = await job.process('job-1');

    expect(result).toEqual({ alerts: 1 });
    expect(repo.upsertLowStockAlert).toHaveBeenCalledWith(variantId, warehouseId, expect.any(Date), expect.anything());
    expect(uow.addEvent).toHaveBeenCalledTimes(1);
    const event = uow.addEvent.mock.calls[0]?.[0];
    expect(event?.name).toBe('inventory.reorder_point.reached.v1');
    expect(event?.payload).toMatchObject({ variantId, warehouseId, quantityAvailable: '2', reorderPoint: '5' });
  });
});

describe('StockReconciliationJob (INV-2)', () => {
  it('repairs projection drift so on-hand equals the ledger sum', async () => {
    const queue = fakeQueue();
    await queue.add(STOCK_RECONCILIATION_JOB, {}, { organizationId: orgId });

    const repo = fakeRepo({
      sumMovementsByVariantWarehouse: vi.fn(async () => [
        { variantId, warehouseId, total: '7' }, // ledger truth
      ]),
      listStockLevels: vi.fn(async () => [
        {
          variantId,
          sku: 'REC-1',
          nameI18n: { en: 'Recon' },
          warehouseId,
          warehouseName: 'Default',
          quantityOnHand: '10', // drift: projection says 10, ledger says 7
          quantityReserved: '0',
          reorderPoint: '5',
          lastMovementId: null,
        },
      ]),
    });

    const job = new StockReconciliationJob(queue as never, repo as never, fakeTxManager() as never);
    const result = await job.process('job-1');

    expect(result).toEqual({ repaired: 1 });
    expect(repo.upsertStockLevel).toHaveBeenCalledWith(variantId, warehouseId, '7', '0', null, expect.anything());
  });

  it('leaves an already-consistent projection untouched', async () => {
    const queue = fakeQueue();
    await queue.add(STOCK_RECONCILIATION_JOB, {}, { organizationId: orgId });

    const repo = fakeRepo({
      sumMovementsByVariantWarehouse: vi.fn(async () => [{ variantId, warehouseId, total: '7' }]),
      listStockLevels: vi.fn(async () => [
        {
          variantId,
          sku: 'REC-1',
          nameI18n: { en: 'Recon' },
          warehouseId,
          warehouseName: 'Default',
          quantityOnHand: '7',
          quantityReserved: '0',
          reorderPoint: '5',
          lastMovementId: null,
        },
      ]),
    });

    const job = new StockReconciliationJob(queue as never, repo as never, fakeTxManager() as never);
    const result = await job.process('job-1');

    expect(result).toEqual({ repaired: 0 });
    expect(repo.upsertStockLevel).not.toHaveBeenCalled();
  });
});
