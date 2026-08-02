import { describe, expect, it } from 'vitest';

import { DESCRIPTOR_ERROR, defineModule, validateDescriptors } from '../src/module/index.js';

// Helpers ────────────────────────────────────────────────────────────────────

const base = {
  version: '1.0.0',
  icon: 'box',
  dependsOn: [] as string[],
  stripePriceKey: 'price_demo_monthly',
  trialDays: 14,
  navigation: [{ labelKey: 'modules.demo.nav.root', href: '/m/demo' }],
  publishes: [] as string[],
  consumes: [] as string[],
  providesPorts: [] as any[],
  consumesPorts: [] as any[],
  searchContributor: false,
  dashboardWidgets: [] as any[],
  dataRetentionDays: 90,
} as const;

const make = (overrides: Record<string, any>) =>
  defineModule({
    key: 'demo',
    nameKey: 'modules.demo.name',
    descriptionKey: 'modules.demo.description',
    tablePrefix: 'dem_',
    permissions: ['demo:thing:read', 'demo:thing:write'],
    ...base,
    ...overrides,
  });

// ─── defineModule(): literal name string rejection ─────────────────────────

describe('defineModule() — descriptor-level validation (PLAN.md §3.1)', () => {
  it('rejects a literal display string in `name` (must be an i18n key)', () => {
    expect(() => make({ nameKey: 'Demo Module' })).toThrowError(/nameKey must be an i18n key starting with "modules."/);
  });

  it('rejects a literal display string in `description`', () => {
    expect(() => make({ descriptionKey: 'A demo module description' })).toThrowError(
      /descriptionKey must be an i18n key starting with "modules."/,
    );
  });

  it('accepts a well-formed descriptor (i18n keys, valid prefix)', () => {
    const d = make({});
    expect(d.key).toBe('demo');
    expect(d.nameKey).toBe('modules.demo.name');
  });

  it('rejects a tablePrefix that does not end with an underscore', () => {
    expect(() => make({ tablePrefix: 'dem' })).toThrowError(/tablePrefix must end with "_"/);
  });

  it('rejects a tablePrefix that does not start with a letter', () => {
    expect(() => make({ tablePrefix: '3dm_' })).toThrowError(/tablePrefix must start with a lowercase letter/);
  });

  it('rejects a tablePrefix with a non-alphanumeric character', () => {
    expect(() => make({ tablePrefix: 'd-m_' })).toThrowError(/tablePrefix must start with a lowercase letter/);
  });

  it('accepts a tablePrefix containing digits after the leading letter (generator key rule)', () => {
    expect(() => make({ tablePrefix: 'demo2_' })).not.toThrow();
  });

  it('rejects a permission key that is not prefixed with the module key', () => {
    expect(() => make({ permissions: ['crm:thing:read'] })).toThrowError(
      /permission "crm:thing:read" must start with the module key "demo:"/,
    );
  });

  it('rejects a published event name that is not prefixed with the module key', () => {
    expect(() => make({ publishes: ['crm.thing.created.v1'] })).toThrowError(
      /published event "crm.thing.created.v1" must start with the module key "demo\."/,
    );
  });

  it('does NOT reject consumed events that start with another module key', () => {
    expect(() => make({ consumes: ['crm.contact.created.v1'] })).not.toThrow();
  });
});

// ─── validateDescriptors(): duplicate tablePrefix (PLAN.md §3.1) ────────────

describe('validateDescriptors() — boot-time cross-descriptor checks', () => {
  it('returns no errors for a single valid descriptor', () => {
    expect(validateDescriptors([make({})])).toEqual([]);
  });

  it('rejects a duplicate tablePrefix across descriptors', () => {
    const a = make({ key: 'demo', nameKey: 'modules.demo.name' });
    const b = defineModule({
      key: 'demo2',
      nameKey: 'modules.demo2.name',
      descriptionKey: 'modules.demo2.description',
      tablePrefix: 'dem_', // collision
      permissions: ['demo2:thing:read'],
      ...base,
    });

    const errors = validateDescriptors([a, b]);
    const codes = errors.map((e) => e.code);
    expect(codes).toContain(DESCRIPTOR_ERROR.DUPLICATE_TABLE_PREFIX);
  });

  it('detects a missing dependency', () => {
    const d = make({ dependsOn: ['nonexistent'] });
    const errors = validateDescriptors([d]);
    expect(errors.map((e) => e.code)).toContain(DESCRIPTOR_ERROR.DEPENDENCY_MISSING);
  });

  it('detects a duplicate permission key', () => {
    // Permissions are key-prefixed (defineModule enforces `<key>:`), so two
    // DIFFERENT module keys can never collide on a permission string. A
    // duplicate permission can only be declared by two descriptors sharing
    // the same key — which is exactly the collision this check reports.
    const a = make({ permissions: ['demo:thing:read'] });
    const b = defineModule({
      ...base,
      key: 'demo',
      nameKey: 'modules.demo.name',
      descriptionKey: 'modules.demo.description',
      tablePrefix: 'demo_',
      permissions: ['demo:thing:read'], // collision on the first module's perm
    });
    const errors = validateDescriptors([a, b]);
    expect(errors.map((e) => e.code)).toContain(DESCRIPTOR_ERROR.DUPLICATE_PERMISSION);
  });

  it('detects a duplicate published event', () => {
    // Same reasoning as permissions: published events are key-prefixed, so a
    // duplicate event name implies two descriptors sharing the same key.
    const a = make({ publishes: ['demo.thing.created.v1'] });
    const b = defineModule({
      ...base,
      key: 'demo',
      nameKey: 'modules.demo.name',
      descriptionKey: 'modules.demo.description',
      tablePrefix: 'demo_',
      permissions: ['demo:thing:read'],
      publishes: ['demo.thing.created.v1'], // collision
    });
    const errors = validateDescriptors([a, b]);
    expect(errors.map((e) => e.code)).toContain(DESCRIPTOR_ERROR.DUPLICATE_EVENT);
  });

  it('detects a duplicate provided port token', () => {
    const port = { token: 'DEMO_PORT', description: 'demo', transactional: false };
    const a = make({ providesPorts: [port] });
    const b = defineModule({
      ...base,
      key: 'demo2',
      nameKey: 'modules.demo2.name',
      descriptionKey: 'modules.demo2.description',
      tablePrefix: 'demo_',
      permissions: ['demo2:thing:read'],
      providesPorts: [port], // collision
    });
    const errors = validateDescriptors([a, b]);
    expect(errors.map((e) => e.code)).toContain(DESCRIPTOR_ERROR.DUPLICATE_PORT);
  });

  it('detects a consumed event that nothing publishes', () => {
    const d = make({ consumes: ['nothing.thing.created.v1'] });
    const errors = validateDescriptors([d]);
    expect(errors.map((e) => e.code)).toContain(DESCRIPTOR_ERROR.CONSUMED_EVENT_MISSING);
  });

  it('detects a consumed port that nothing provides', () => {
    const d = make({
      consumesPorts: [{ token: 'MISSING_PORT', description: 'x', transactional: false }],
    });
    const errors = validateDescriptors([d]);
    expect(errors.map((e) => e.code)).toContain(DESCRIPTOR_ERROR.CONSUMED_PORT_MISSING);
  });

  it('detects a duplicate module key', () => {
    const a = make({});
    const b = defineModule({
      ...base,
      key: 'demo',
      nameKey: 'modules.demo.name',
      descriptionKey: 'modules.demo.description',
      tablePrefix: 'demo_',
      permissions: ['demo:thing:read'],
    });
    const errors = validateDescriptors([a, b]);
    expect(errors.map((e) => e.code)).toContain(DESCRIPTOR_ERROR.DUPLICATE_KEY);
  });

  it('returns no errors for a mutually consistent multi-module set', () => {
    const inv = defineModule({
      key: 'inventory',
      nameKey: 'modules.inventory.name',
      descriptionKey: 'modules.inventory.description',
      tablePrefix: 'inv_',
      permissions: ['inventory:product:read'],
      publishes: ['inventory.stock.depleted.v1'],
      providesPorts: [{ token: 'INVENTORY_STOCK_PORT', description: 'stock', transactional: true }],
      ...base,
      stripePriceKey: 'price_inv',
    });
    const pos = defineModule({
      key: 'pos',
      nameKey: 'modules.pos.name',
      descriptionKey: 'modules.pos.description',
      tablePrefix: 'pos_',
      dependsOn: ['inventory'],
      permissions: ['pos:sale:create'],
      consumes: ['inventory.stock.depleted.v1'],
      consumesPorts: [{ token: 'INVENTORY_STOCK_PORT', description: 'stock', transactional: true }],
      ...base,
      stripePriceKey: 'price_pos',
    });
    expect(validateDescriptors([inv, pos])).toEqual([]);
  });
});
