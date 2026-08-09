import { POS_EVENTS, type PosShiftOpenedV1 } from '@modubiz/contracts';
import { Inject, Injectable } from '@nestjs/common';

import { NotFoundError } from '../../../core/common/errors.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { UnitOfWork } from '../../../core/database/unit-of-work.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { PosError, POS_ERROR_CODE, Shift, SHIFT_STATUS } from '../domain/index.js';

import { POS_REPOSITORY, type PosRepository } from './ports/index.js';

export interface OpenShiftInput {
  registerId: string;
  /** POS-4: the opening cash float. */
  openingFloatAmountMinor: string;
  /** The register currency = the org base currency (POS-11). */
  currency: string;
}

/**
 * OpenShiftUseCase — opens a cash session on a register (POS-4).
 *
 * Business rules:
 * - POS-2: at most one open shift per register — re-checked here and enforced
 *   by the partial unique index `uq_pos_shifts_open`.
 * - POS-4: opening records the opening float and the operator.
 */
@Injectable()
export class OpenShiftUseCase {
  constructor(
    @Inject(POS_REPOSITORY)
    private readonly repo: PosRepository,
    private readonly txManager: TransactionManager,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  async execute(input: OpenShiftInput): Promise<{ shiftId: string; openedAt: string }> {
    const organizationId = TenantContext.requireOrganizationId();
    const userId = TenantContext.getUserId() ?? 'system';
    const now = new Date();

    const committed = await this.txManager.run(async (tx) => {
      const register = await this.repo.findRegisterById(input.registerId, tx);
      if (!register) throw new NotFoundError('POS_REGISTER_NOT_FOUND', { registerId: input.registerId });

      // POS-2: reject a second open shift on the same register.
      const existing = await this.repo.findOpenShiftByRegister(input.registerId, tx);
      if (existing) {
        throw new PosError(POS_ERROR_CODE.SHIFT_ALREADY_OPEN, 'A shift is already open on this register (POS-2).', {
          registerId: input.registerId,
          openShiftId: existing.id,
        });
      }

      const shift = Shift.create({
        id: crypto.randomUUID(),
        organizationId,
        registerId: input.registerId,
        openedBy: userId,
        openedAt: now,
        openingFloatAmountMinor: input.openingFloatAmountMinor,
        closedBy: null,
        closedAt: null,
        countedCashAmountMinor: null,
        expectedCashAmountMinor: null,
        varianceAmountMinor: null,
        currency: input.currency,
        status: SHIFT_STATUS.OPEN,
        forcedClose: false,
        createdAt: now,
        updatedAt: now,
        createdBy: userId,
        updatedBy: userId,
      });

      const persisted = await this.repo.insertShift(shift.toJSON(), tx);

      const payload: PosShiftOpenedV1 = {
        organizationId,
        shiftId: persisted.id,
        registerId: input.registerId,
        openedBy: userId,
        openingFloatAmountMinor: input.openingFloatAmountMinor,
        currency: input.currency,
        openedAt: now.toISOString(),
        occurredAt: now.toISOString(),
      };
      const event = {
        name: POS_EVENTS.SHIFT_OPENED_V1,
        payload,
        aggregateId: persisted.id,
      } satisfies Parameters<UnitOfWork['addEvent']>[0];

      return { shiftId: persisted.id, openedAt: now.toISOString(), event };
    });

    this.unitOfWork.addEvent(committed.event);
    await this.unitOfWork.publishEvents();
    return { shiftId: committed.shiftId, openedAt: committed.openedAt };
  }
}
