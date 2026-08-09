import { Inject, Injectable } from '@nestjs/common';

import { TransactionManager } from '../../../core/database/transaction-manager.js';

import { type ShiftRow, POS_REPOSITORY, type PosRepository } from './ports/index.js';

/**
 * ListShiftsUseCase — all shifts for the org, newest first (shifts page).
 */
@Injectable()
export class ListShiftsUseCase {
  constructor(
    @Inject(POS_REPOSITORY)
    private readonly repo: PosRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(): Promise<ShiftRow[]> {
    return this.txManager.run((tx) => this.repo.listShifts(tx));
  }
}
