import { Module, type DynamicModule, type Type } from '@nestjs/common';

import { SEARCH_CONTRIBUTORS } from '@modubiz/contracts';

import { ModuleRegistryModule } from '../module-registry/module-registry.module.js';
import { FederatedSearchUseCase } from './application/index.js';
import { SearchController } from './api/index.js';
import type { SearchContributor } from './ports/index.js';

/**
 * SearchModule — federated search aggregator.
 *
 * The `SEARCH_CONTRIBUTORS` collection is pluggable: the composition root
 * passes each registered module's contributor CLASS via `register()`. Each
 * class is instantiated by Nest (so its own deps resolve — e.g.
 * TransactionManager / DRIZZLE_DB come from the @Global DatabaseModule) and
 * the collection is assembled with a `useFactory` provider.
 *
 * The collection MUST live in this module's context — Nest only resolves a
 * provider's dependencies from its own module and the modules it imports, so
 * contributors registered at the AppModule level would be invisible to
 * FederatedSearchUseCase (boot-time UnknownDependenciesException).
 *
 * ModuleRegistryModule is imported for the entitlement check that gates which
 * contributors are queried for an organization.
 */
@Module({})
export class SearchModule {
  static register(contributors: Array<Type<SearchContributor>>): DynamicModule {
    // Each contributor becomes a named provider so Nest instantiates it with
    // its DI deps; the SEARCH_CONTRIBUTORS token then aggregates the instances.
    // (Deliberately not `multi: true` — this Nest build does not honor multi
    // providers, so the collection is built explicitly instead.)
    const contributorProviders = contributors.map((contributor, index) => ({
      provide: `SEARCH_CONTRIBUTOR_${index}`,
      useClass: contributor,
    }));

    return {
      module: SearchModule,
      imports: [ModuleRegistryModule],
      controllers: [SearchController],
      providers: [
        FederatedSearchUseCase,
        ...contributorProviders,
        {
          provide: SEARCH_CONTRIBUTORS,
          useFactory: (...instances: SearchContributor[]) => instances,
          inject: contributorProviders.map((provider) => provider.provide),
        },
      ],
    };
  }
}
