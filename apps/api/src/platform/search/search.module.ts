import { Module } from '@nestjs/common';
import type { Provider } from '@nestjs/common';

import { FederatedSearchUseCase } from './application/index.js';
import { SearchController } from './api/index.js';
import { SEARCH_CONTRIBUTORS, type SearchContributor } from './ports/index.js';

// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any -- multi-provider typing limitation
const searchContributorsProvider = {
  provide: SEARCH_CONTRIBUTORS,
  useValue: [] as SearchContributor[],
  multi: true,
} as any;

@Module({
  controllers: [SearchController],
  providers: [
    FederatedSearchUseCase,
    searchContributorsProvider,
  ],
})
export class SearchModule {}
