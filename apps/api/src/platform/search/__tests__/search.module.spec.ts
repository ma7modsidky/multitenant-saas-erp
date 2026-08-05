import 'reflect-metadata'; // Nest decorators + design:paramtypes reflection

import { Test } from '@nestjs/testing';
import { type SearchContributor } from '@modubiz/contracts';
import { describe, expect, it, vi } from 'vitest';

import { DRIZZLE_DB } from '../../../core/database/drizzle.provider.js';
import { UnitOfWork } from '../../../core/database/unit-of-work.js';
import { MODULE_REGISTRY_REPOSITORY } from '../../module-registry/ports/index.js';
import { FederatedSearchUseCase } from '../application/federated-search.use-case.js';
import { SearchModule } from '../search.module.js';

class FakeContributor implements SearchContributor {
  readonly moduleKey = 'crm';
  readonly labelKey = 'modules.crm.name';
  search = vi.fn().mockResolvedValue([{ id: 'c1', title: 'John Doe', href: '/m/crm/contacts/c1' }]);
}

/** Compile a container with SearchModule.register(...) and DB infra stubbed out. */
async function compile(contributors: Array<typeof FakeContributor>) {
  return (
    Test.createTestingModule({
      imports: [SearchModule.register(contributors)],
    })
      // ModuleRegistryModule imports the @Global DatabaseModule; overriding its
      // providers keeps the real pool / event bus out of the test container.
      .overrideProvider(DRIZZLE_DB)
      .useValue({})
      .overrideProvider(UnitOfWork)
      .useValue({})
      .overrideProvider(MODULE_REGISTRY_REPOSITORY)
      .useValue({ listEntitlements: vi.fn().mockResolvedValue([{ moduleKey: 'crm', state: 'active' }]) })
      .compile()
  );
}

/**
 * DI wiring regression test: contributor classes registered via register()
 * must be instantiated and injected into FederatedSearchUseCase. Before the
 * dynamic-module refactor the SEARCH_CONTRIBUTORS token lived in AppModule's
 * context and the container failed to boot with UnknownDependenciesException.
 */
describe('SearchModule wiring', () => {
  it('injects the registered contributors into FederatedSearchUseCase', async () => {
    const moduleRef = await compile([FakeContributor]);

    const useCase = moduleRef.get(FederatedSearchUseCase);
    expect(useCase).toBeInstanceOf(FederatedSearchUseCase);

    const injected = useCase as unknown as { contributors: SearchContributor[] };
    expect(injected.contributors).toHaveLength(1);
    expect(injected.contributors[0]).toBeInstanceOf(FakeContributor);
    expect(injected.contributors[0]).toMatchObject({ moduleKey: 'crm', labelKey: 'modules.crm.name' });
  });

  it('boots with zero registered contributors (empty collection)', async () => {
    const moduleRef = await compile([]);

    const useCase = moduleRef.get(FederatedSearchUseCase);
    const injected = useCase as unknown as { contributors: SearchContributor[] };
    expect(injected.contributors).toEqual([]);
  });
});
