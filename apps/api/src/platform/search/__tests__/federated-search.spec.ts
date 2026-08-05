import { describe, expect, it, vi } from 'vitest';

import type { TransactionManager } from '../../../core/database/transaction-manager.js';
import type { ModuleRegistryRepository } from '../../module-registry/ports/index.js';
import { FederatedSearchUseCase } from '../application/federated-search.use-case.js';
import type { SearchContributor } from '../ports/index.js';

function createMockContributor(
  moduleKey: string,
  labelKey: string,
  results: Array<{ id: string; title: string; description?: string; href: string; icon?: string }>,
  shouldReject = false,
): SearchContributor {
  return {
    moduleKey,
    labelKey,
    search: vi.fn().mockImplementation(async (_query: string, _orgId: string, _limit: number) => {
      if (shouldReject) throw new Error(`Search failed for ${moduleKey}`);
      return results;
    }),
  };
}

/**
 * Build a use case with a fake entitlement source. `entitlements` defaults to
 * active entitlements for crm + inventory (the moduleKeys the fixtures use).
 */
function createUseCase(
  contributors: SearchContributor[],
  entitlements: Array<{ moduleKey: string; state: string }> = [
    { moduleKey: 'crm', state: 'active' },
    { moduleKey: 'inventory', state: 'active' },
  ],
): FederatedSearchUseCase {
  const moduleRepo = {
    listEntitlements: vi.fn().mockResolvedValue(entitlements),
  } as unknown as ModuleRegistryRepository;
  const tx = {
    run: vi.fn(async (fn: (db: unknown) => Promise<unknown>) => fn({})),
  } as unknown as TransactionManager;
  return new FederatedSearchUseCase(contributors, moduleRepo, tx);
}

describe('FederatedSearchUseCase', () => {
  it('returns empty array for empty query', async () => {
    const useCase = createUseCase([]);
    const result = await useCase.execute({ query: '', organizationId: 'org-1' });
    expect(result).toEqual([]);
  });

  it('returns empty array for whitespace-only query', async () => {
    const useCase = createUseCase([]);
    const result = await useCase.execute({ query: '   ', organizationId: 'org-1' });
    expect(result).toEqual([]);
  });

  it('returns empty array for single-char query (minimum 2 chars)', async () => {
    const useCase = createUseCase([]);
    const result = await useCase.execute({ query: 'a', organizationId: 'org-1' });
    expect(result).toEqual([]);
  });

  it('queries all contributors and aggregates results', async () => {
    const contributor1 = createMockContributor('crm', 'modules.crm.name', [
      { id: 'contact-1', title: 'John Doe', href: '/m/crm/contacts/contact-1' },
    ]);

    const contributor2 = createMockContributor('inventory', 'modules.inventory.name', [
      { id: 'prod-1', title: 'Widget', description: 'A widget', href: '/m/inventory/products/prod-1' },
    ]);

    const useCase = createUseCase([contributor1, contributor2]);
    const result = await useCase.execute({ query: 'john', organizationId: 'org-1' });

    expect(result).toHaveLength(2);
    expect(result[0]!.moduleKey).toBe('crm');
    expect(result[0]!.results).toHaveLength(1);
    expect(result[1]!.moduleKey).toBe('inventory');
    expect(result[1]!.results).toHaveLength(1);
  });

  it('skips contributors with empty results', async () => {
    const contributor1 = createMockContributor('crm', 'modules.crm.name', []);
    const contributor2 = createMockContributor('inventory', 'modules.inventory.name', [
      { id: 'prod-1', title: 'Widget', href: '/m/inventory/products/prod-1' },
    ]);

    const useCase = createUseCase([contributor1, contributor2]);
    const result = await useCase.execute({ query: 'widget', organizationId: 'org-1' });

    expect(result).toHaveLength(1);
    expect(result[0]!.moduleKey).toBe('inventory');
  });

  it('handles a failing contributor gracefully (Promise.allSettled)', async () => {
    const contributor1 = createMockContributor('crm', 'modules.crm.name', [
      { id: 'contact-1', title: 'John Doe', href: '/m/crm/contacts/contact-1' },
    ]);
    const contributor2 = createMockContributor('inventory', 'modules.inventory.name', [], true);

    const useCase = createUseCase([contributor1, contributor2]);
    const result = await useCase.execute({ query: 'john', organizationId: 'org-1' });

    // Should still get results from the working contributor
    expect(result).toHaveLength(1);
    expect(result[0]!.moduleKey).toBe('crm');
  });

  it('skips contributors whose module is not entitled to the org', async () => {
    const crmContributor = createMockContributor('crm', 'modules.crm.name', [
      { id: 'contact-1', title: 'John Doe', href: '/m/crm/contacts/contact-1' },
    ]);
    const inventoryContributor = createMockContributor('inventory', 'modules.inventory.name', [
      { id: 'prod-1', title: 'Widget', href: '/m/inventory/products/prod-1' },
    ]);

    // The org disabled CRM after a trial — only inventory results may appear.
    const useCase = createUseCase(
      [crmContributor, inventoryContributor],
      [{ moduleKey: 'inventory', state: 'active' }],
    );
    const result = await useCase.execute({ query: 'john', organizationId: 'org-1' });

    expect(result).toHaveLength(1);
    expect(result[0]!.moduleKey).toBe('inventory');
    expect(crmContributor.search).not.toHaveBeenCalled();
  });

  it('returns no results when no contributor module is entitled', async () => {
    const crmContributor = createMockContributor('crm', 'modules.crm.name', [
      { id: 'contact-1', title: 'John Doe', href: '/m/crm/contacts/contact-1' },
    ]);
    const useCase = createUseCase([crmContributor], [{ moduleKey: 'crm', state: 'none' }]);

    const result = await useCase.execute({ query: 'john', organizationId: 'org-1' });
    expect(result).toEqual([]);
    expect(crmContributor.search).not.toHaveBeenCalled();
  });

  it('handles all contributors failing', async () => {
    const contributor1 = createMockContributor('crm', 'modules.crm.name', [], true);
    const contributor2 = createMockContributor('inventory', 'modules.inventory.name', [], true);

    const useCase = createUseCase([contributor1, contributor2]);
    const result = await useCase.execute({ query: 'test', organizationId: 'org-1' });

    expect(result).toEqual([]);
  });

  it('respects limit per contributor', async () => {
    const contributor = createMockContributor('crm', 'modules.crm.name', [
      { id: 'c1', title: 'Contact 1', href: '/m/crm/c1' },
      { id: 'c2', title: 'Contact 2', href: '/m/crm/c2' },
      { id: 'c3', title: 'Contact 3', href: '/m/crm/c3' },
    ]);

    const useCase = createUseCase([contributor]);
    await useCase.execute({ query: 'contact', organizationId: 'org-1', limit: 2 });

    expect(contributor.search).toHaveBeenCalledWith('contact', 'org-1', 2);
  });

  it('caps limit at 20', async () => {
    const contributor = createMockContributor('crm', 'modules.crm.name', []);

    const useCase = createUseCase([contributor]);
    await useCase.execute({ query: 'test', organizationId: 'org-1', limit: 100 });

    expect(contributor.search).toHaveBeenCalledWith('test', 'org-1', 20);
  });

  it('handles no contributors gracefully', async () => {
    const useCase = createUseCase([]);
    const result = await useCase.execute({ query: 'test', organizationId: 'org-1' });
    expect(result).toEqual([]);
  });

  it('does not query entitlements for short queries (fail fast)', async () => {
    const useCase = createUseCase([]);
    const result = await useCase.execute({ query: 'a', organizationId: 'org-1' });
    expect(result).toEqual([]);
  });
});
