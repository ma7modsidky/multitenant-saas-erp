import { Inject, Injectable } from '@nestjs/common';

import { TransactionManager } from '../../../core/database/transaction-manager.js';

import { type RegisterRow, POS_REPOSITORY, type PosRepository } from './ports/index.js';

/**
 * ListRegistersUseCase — the registers the UI needs (POS-1 binding + the open
 * shift marker for the shifts page).
 */
@Injectable()
export class ListRegistersUseCase {
  constructor(
    @Inject(POS_REPOSITORY)
    private readonly repo: PosRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(): Promise<RegisterRow[]> {
    return this.txManager.run((tx) => this.repo.listRegisters(tx));
  }
}
