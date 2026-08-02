import { Module } from '@nestjs/common';
import type { Provider } from '@nestjs/common';

import { FederatedSearchUseCase } from './application/index.js';
import { SearchController } from './api/index.js';
import { SEARCH_CONTRIBUTORS, type SearchContributor } from './ports/index.js';

// Multi-providers are not part of the base Provider union, so the extra
// `multi` flag requires a cast to the Provider type (Nest typing limitation).
const searchContributorsProvider = {
  provide: SEARCH_CONTRIBUTORS,
  useValue: [] as SearchContributor[],
  multi: true,
} as Provider;

@Module({
  controllers: [SearchController],
  providers: [FederatedSearchUseCase, searchContributorsProvider],
})
export class SearchModule {}
