import { POS_EVENTS, type PosShiftClosedV1 } from '@modubiz/contracts';
import { Inject, Injectable } from '@nestjs/common';

import { NotFoundError } from '../../../core/common/errors.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { UnitOfWork } from '../../../core/database/unit-of-work.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { PosError, POS_ERROR_CODE, Shift } from '../domain/index.js';

import { POS_REPOSITORY, type PosRepository } from './ports/index.js';

export interface CloseShiftDetails {
  /** POS-5: the counted cash in the drawer. */
  countedCashAmountMinor: string;
  /**
   * POS-7: a MANAGER may force-close despite unsynced offline sales in the
   * client outbox; the flag is recorded and the event marks `forcedClose`.
   */
  forcedClose?: boolean;
}

export interface CloseShiftInput extends CloseShiftDetails {
  shiftId: string;
}

/**
 * CloseShiftUseCase — closes a shift, computes the cash variance, locks it.
 *
 * Business rules:
 * - POS-5: expected cash = opening float + cash sales − cash refunds; variance
 *   = counted − expected (negative = shortage). All stored on the shift.
 * - POS-6: a closed shift is immutable — closing twice throws.
 * - POS-7: the shift cannot be closed while unsynced offline sales remain in
 *   the client outbox, unless a manager force-closes.
 */
@Injectable()
export class CloseShiftUseCase {
  constructor(
    @Inject(POS_REPOSITORY)
    private readonly repo: PosRepository,
    private readonly txManager: TransactionManager,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  async execute(input: CloseShiftInput): Promise<{
    shiftId: string;
    expectedCashAmountMinor: string;
    varianceAmountMinor: string;
    closedAt: string;
  }> {
    return this.executeInternal(input.shiftId, input, this.repo, this.txManager);
  }

  /**
   * Register-scoped close (POST /registers/:id/shifts/close): resolves the
   * currently open shift on the register, then closes it (POS-3/5).
   */
  async executeForRegister(
    registerId: string,
    input: CloseShiftDetails,
  ): Promise<{
    shiftId: string;
    expectedCashAmountMinor: string;
    varianceAmountMinor: string;
    closedAt: string;
  }> {
    const openShift = await this.txManager.run((tx) => this.repo.findOpenShiftByRegister(registerId, tx));
    if (!openShift) {
      throw new PosError(POS_ERROR_CODE.NO_OPEN_SHIFT, 'Closing requires an open shift on the register (POS-3).', {
        registerId,
      });
    }
    return this.executeInternal(openShift.id, input, this.repo, this.txManager);
  }

  private async executeInternal(
    shiftId: string,
    input: CloseShiftDetails,
    repo: PosRepository,
    txManager: TransactionManager,
  ): Promise<{
    shiftId: string;
    expectedCashAmountMinor: string;
    varianceAmountMinor: string;
    closedAt: string;
  }> {
    const userId = TenantContext.getUserId() ?? 'system';
    const now = new Date();

    const committed = await txManager.run(async (tx) => {
      const row = await repo.findShiftById(shiftId, tx);
      if (!row) throw new NotFoundError('POS_SHIFT_NOT_FOUND', { shiftId });

      const shift = Shift.fromPersistence(row);

      // POS-7: cannot close with unsynced offline sales unless forced.
      const hasUnsynced = await repo.hasUnsyncedSalesInShift(shiftId, tx);
      if (hasUnsynced && !input.forcedClose) {
        throw new PosError(
          POS_ERROR_CODE.SHIFT_HAS_UNSYNCED_SALES,
          'Close the register only after offline sales sync, or force-close as a manager (POS-7).',
          { shiftId },
        );
      }

      const cashSales = await repo.sumCashSalesByShift(shiftId, tx);
      const refunds = await repo.sumRefundsByShift(shiftId, tx);

      // POS-5: expected = float + cash sales − cash refunds; variance = counted − expected.
      shift.close({
        countedCashAmountMinor: input.countedCashAmountMinor,
        cashSalesAmountMinor: cashSales,
        cashRefundsAmountMinor: refunds,
        forcedClose: input.forcedClose ?? false,
        closedBy: userId,
        now,
      });

      await repo.updateShiftClosed(shift.toJSON(), tx);

      const payload: PosShiftClosedV1 = {
        organizationId: shift.organizationId,
        shiftId: shift.id,
        registerId: shift.registerId,
        closedBy: userId,
        expectedCashAmountMinor: shift.expectedCashAmountMinor ?? '0',
        countedCashAmountMinor: input.countedCashAmountMinor,
        varianceAmountMinor: shift.varianceAmountMinor ?? '0',
        currency: shift.currency,
        ...(shift.forcedClose ? { forcedClose: true } : {}),
        closedAt: now.toISOString(),
        occurredAt: now.toISOString(),
      };
      const event = {
        name: POS_EVENTS.SHIFT_CLOSED_V1,
        payload,
        aggregateId: shift.id,
      } satisfies Parameters<UnitOfWork['addEvent']>[0];

      return {
        shiftId: shift.id,
        expectedCashAmountMinor: shift.expectedCashAmountMinor ?? '0',
        varianceAmountMinor: shift.varianceAmountMinor ?? '0',
        closedAt: now.toISOString(),
        event,
      };
    });

    this.unitOfWork.addEvent(committed.event);
    await this.unitOfWork.publishEvents();
    return {
      shiftId: committed.shiftId,
      expectedCashAmountMinor: committed.expectedCashAmountMinor,
      varianceAmountMinor: committed.varianceAmountMinor,
      closedAt: committed.closedAt,
    };
  }
}
