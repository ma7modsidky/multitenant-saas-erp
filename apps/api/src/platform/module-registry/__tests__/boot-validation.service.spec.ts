import { defineModule } from '@modubiz/contracts';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { BootValidationService } from '../application/boot-validation.service.js';
import { MODULE_BOOT_VALIDATION_FAILED } from '../domain/index.js';

// ─── Mocks ─────────────────────────────────────────────────────────────────

// vi.mock is hoisted above imports, so the mutable fixture holder must be
// created with vi.hoisted() to avoid a temporal-dead-zone error.
const { fixtures } = vi.hoisted(() => ({ fixtures: { value: [] as unknown[] } }));

const repo = {
  upsertModule: vi.fn(async () => {}),
  upsertPermission: vi.fn(async () => {}),
  pruneStaleModules: vi.fn(async () => ({ removed: [] as string[], kept: [] as string[] })),
};

vi.mock('../registered-modules.js', () => ({
  get REGISTERED_MODULES() {
    return fixtures.value;
  },
}));

// ─── Valid descriptor factory (self-contained, no real modules needed) ──────

function makeModule(overrides: Record<string, unknown> = {}) {
  return defineModule({
    key: 'crm',
    version: '1.0.0',
    nameKey: 'modules.crm.name',
    descriptionKey: 'modules.crm.description',
    icon: 'box',
    tablePrefix: 'crm_',
    dependsOn: [],
    stripePriceKey: 'price_crm_monthly',
    trialDays: 14,
    permissions: ['crm:thing:read'],
    navigation: [{ labelKey: 'modules.crm.nav.root', href: '/m/crm' }],
    publishes: [],
    consumes: [],
    providesPorts: [],
    consumesPorts: [],
    searchContributor: false,
    dashboardWidgets: [],
    dataRetentionDays: 90,
    ...overrides,
  });
}

describe('BootValidationService — PLAN.md §3.3 (shared validateDescriptors codes)', () => {
  beforeEach(() => {
    fixtures.value = [];
    vi.clearAllMocks();
  });

  it('passes validation and syncs modules + permissions when descriptors are consistent', async () => {
    fixtures.value = [
      makeModule(),
      makeModule({
        key: 'pos',
        nameKey: 'modules.pos.name',
        descriptionKey: 'modules.pos.description',
        tablePrefix: 'pos_',
        permissions: ['pos:thing:read'],
      }),
    ];
    const service = new BootValidationService(repo as never);

    await expect(service.validateAndSync()).resolves.toBeUndefined();
    expect(repo.upsertModule).toHaveBeenCalledTimes(2);
    expect(repo.upsertPermission).toHaveBeenCalledTimes(2);
    expect(repo.pruneStaleModules).toHaveBeenCalledWith(['crm', 'pos']);
  });

  it('logs stale catalog entries pruned at boot (mirror semantics)', async () => {
    fixtures.value = [makeModule()];
    repo.pruneStaleModules.mockResolvedValue({ removed: ['demo'], kept: [] });
    const service = new BootValidationService(repo as never);

    await expect(service.validateAndSync()).resolves.toBeUndefined();
    expect(repo.pruneStaleModules).toHaveBeenCalledWith(['crm']);
  });

  it('keeps catalog entries still referenced by entitlements', async () => {
    fixtures.value = [makeModule()];
    repo.pruneStaleModules.mockResolvedValue({ removed: [], kept: ['legacy'] });
    const service = new BootValidationService(repo as never);

    await expect(service.validateAndSync()).resolves.toBeUndefined();
  });

  it('throws MODULE_BOOT_VALIDATION_FAILED when a dependency is missing', async () => {
    fixtures.value = [makeModule({ dependsOn: ['nonexistent'] })];
    const service = new BootValidationService(repo as never);

    await expect(service.validateAndSync()).rejects.toThrow(MODULE_BOOT_VALIDATION_FAILED);
    expect(repo.upsertModule).not.toHaveBeenCalled();
  });

  it('throws MODULE_BOOT_VALIDATION_FAILED on a duplicate table prefix', async () => {
    fixtures.value = [
      makeModule(),
      makeModule({
        key: 'pos',
        nameKey: 'modules.pos.name',
        descriptionKey: 'modules.pos.description',
        tablePrefix: 'crm_', // collision with crm
        permissions: ['pos:thing:read'],
      }),
    ];
    const service = new BootValidationService(repo as never);

    await expect(service.validateAndSync()).rejects.toThrow(MODULE_BOOT_VALIDATION_FAILED);
    expect(repo.upsertModule).not.toHaveBeenCalled();
  });

  it('throws MODULE_BOOT_VALIDATION_FAILED on a duplicate published event', async () => {
    fixtures.value = [
      makeModule({ publishes: ['crm.thing.created.v1'] }),
      makeModule({
        key: 'crm',
        nameKey: 'modules.crm.name',
        descriptionKey: 'modules.crm.description',
        tablePrefix: 'crx_',
        permissions: ['crm:thing:read'],
        publishes: ['crm.thing.created.v1'], // collision
      }),
    ];
    const service = new BootValidationService(repo as never);

    await expect(service.validateAndSync()).rejects.toThrow(MODULE_BOOT_VALIDATION_FAILED);
  });

  it('throws MODULE_BOOT_VALIDATION_FAILED when a consumed port is not provided anywhere', async () => {
    fixtures.value = [
      makeModule({
        consumesPorts: [{ token: 'MISSING_PORT', description: 'x', transactional: false }],
      }),
    ];
    const service = new BootValidationService(repo as never);

    await expect(service.validateAndSync()).rejects.toThrow(MODULE_BOOT_VALIDATION_FAILED);
  });
});
