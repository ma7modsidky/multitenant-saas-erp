import { Injectable } from '@nestjs/common';

/**
 * Trivial scaffold use case — replace with the module's real business use cases
 * (one use case per operation, owning its transaction; see MODULE_GUIDE.md §4
 * Step 5).
 */
@Injectable()
export class GetStatusUseCase {
  async execute(): Promise<{ module: string; status: string }> {
    return { module: 'inventory', status: 'ok' };
  }
}
