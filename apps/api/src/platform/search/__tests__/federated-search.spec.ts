import { describe, expect, it, vi } from 'vitest';

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

describe('FederatedSearchUseCase', () => {
  it('returns empty array for empty query', async () => {
    const useCase = new FederatedSearchUseCase([]);
    const result = await useCase.execute({ query: '', organizationId: 'org-1' });
    expect(result).toEqual([]);
  });

  it('returns empty array for whitespace-only query', async () => {
    const useCase = new FederatedSearchUseCase([]);
    const result = await useCase.execute({ query: '   ', organizationId: 'org-1' });
    expect(result).toEqual([]);
  });

  it('returns empty array for single-char query (minimum 2 chars)', async () => {
    const useCase = new FederatedSearchUseCase([]);
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

    const useCase = new FederatedSearchUseCase([contributor1, contributor2]);
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

    const useCase = new FederatedSearchUseCase([contributor1, contributor2]);
    const result = await useCase.execute({ query: 'widget', organizationId: 'org-1' });

    expect(result).toHaveLength(1);
    expect(result[0]!.moduleKey).toBe('inventory');
  });

  it('handles a failing contributor gracefully (Promise.allSettled)', async () => {
    const contributor1 = createMockContributor('crm', 'modules.crm.name', [
      { id: 'contact-1', title: 'John Doe', href: '/m/crm/contacts/contact-1' },
    ]);
    const contributor2 = createMockContributor('inventory', 'modules.inventory.name', [], true);

    const useCase = new FederatedSearchUseCase([contributor1, contributor2]);
    const result = await useCase.execute({ query: 'john', organizationId: 'org-1' });

    // Should still get results from the working contributor
    expect(result).toHaveLength(1);
    expect(result[0]!.moduleKey).toBe('crm');
  });

  it('handles all contributors failing', async () => {
    const contributor1 = createMockContributor('crm', 'modules.crm.name', [], true);
    const contributor2 = createMockContributor('inventory', 'modules.inventory.name', [], true);

    const useCase = new FederatedSearchUseCase([contributor1, contributor2]);
    const result = await useCase.execute({ query: 'test', organizationId: 'org-1' });

    expect(result).toEqual([]);
  });

  it('respects limit per contributor', async () => {
    const contributor = createMockContributor('crm', 'modules.crm.name', [
      { id: 'c1', title: 'Contact 1', href: '/m/crm/c1' },
      { id: 'c2', title: 'Contact 2', href: '/m/crm/c2' },
      { id: 'c3', title: 'Contact 3', href: '/m/crm/c3' },
    ]);

    const useCase = new FederatedSearchUseCase([contributor]);
    await useCase.execute({ query: 'contact', organizationId: 'org-1', limit: 2 });

    expect(contributor.search).toHaveBeenCalledWith('contact', 'org-1', 2);
  });

  it('caps limit at 20', async () => {
    const contributor = createMockContributor('crm', 'modules.crm.name', []);

    const useCase = new FederatedSearchUseCase([contributor]);
    await useCase.execute({ query: 'test', organizationId: 'org-1', limit: 100 });

    expect(contributor.search).toHaveBeenCalledWith('test', 'org-1', 20);
  });

  it('handles no contributors gracefully', async () => {
    const useCase = new FederatedSearchUseCase([]);
    const result = await useCase.execute({ query: 'test', organizationId: 'org-1' });
    expect(result).toEqual([]);
  });
});
