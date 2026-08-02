import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { FederatedSearchUseCase } from '../application/index.js';
import { type SearchResponse } from './dto/index.js';

@Controller('v1')
@UseGuards(AuthGuard('jwt'))
export class SearchController {
  constructor(private readonly federatedSearchUseCase: FederatedSearchUseCase) {}

  /**
   * GET /v1/search?q=<query>
   * Federated search across all registered module contributors.
   */
  @Get('search')
  async search(@Query('q') q?: string): Promise<{ data: SearchResponse }> {
    const orgId = TenantContext.requireOrganizationId();
    const query = q ?? '';

    const results = await this.federatedSearchUseCase.execute({
      query,
      organizationId: orgId,
    });

    return {
      data: {
        query,
        results,
      },
    };
  }
}
