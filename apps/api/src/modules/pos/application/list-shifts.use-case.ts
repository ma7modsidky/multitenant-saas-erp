import { Inject, Injectable } from '@nestjs/common';

import { TransactionManager } from '../../../core/database/transaction-manager.js';

import { POS_REPOSITORY, type PosRepository, type ShiftListFilter, type ShiftSummaryRow } from './ports/index.js';

/**
 * ListShiftsUseCase — all shifts for the org, newest first (shifts page),
 * optionally restricted to an opened_at date range. Each row carries its
 * sales/refund aggregates (count + minor-unit sums) so the list can show
 * filtered totals.
 */
@Injectable()
export class ListShiftsUseCase {
  constructor(
    @Inject(POS_REPOSITORY)
    private readonly repo: PosRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(filter: ShiftListFilter = {}): Promise<ShiftSummaryRow[]> {
    return this.txManager.run((tx) => this.repo.listShifts(filter, tx));
  }
}
