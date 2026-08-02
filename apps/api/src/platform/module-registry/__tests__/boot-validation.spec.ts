import { describe, expect, it } from 'vitest';

import { REGISTERED_MODULES } from '../registered-modules.js';

describe('REGISTERED_MODULES - descriptor integrity', () => {
  it('registers the three core modules that ship with the platform', () => {
    const keys = REGISTERED_MODULES.map((m) => m.key);
    expect(keys).toEqual(expect.arrayContaining(['crm', 'inventory', 'pos']));
  });

  it('all module keys are unique', () => {
    const keys = REGISTERED_MODULES.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('all table prefixes are unique', () => {
    const prefixes = REGISTERED_MODULES.map((m) => m.tablePrefix);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });

  it('dependsOn references only registered modules', () => {
    const keys = new Set(REGISTERED_MODULES.map((m) => m.key));
    for (const module of REGISTERED_MODULES) {
      for (const dep of module.dependsOn) {
        expect(keys.has(dep)).toBe(true);
      }
    }
  });

  it('no duplicate permission keys across modules', () => {
    const permissions = new Set<string>();
    const duplicates: string[] = [];

    for (const module of REGISTERED_MODULES) {
      for (const perm of module.permissions) {
        if (permissions.has(perm)) duplicates.push(perm);
        permissions.add(perm);
      }
    }

    expect(duplicates).toEqual([]);
  });

  it('no duplicate published event names across modules', () => {
    const events = new Set<string>();
    const duplicates: string[] = [];

    for (const module of REGISTERED_MODULES) {
      for (const event of module.publishes) {
        if (events.has(event)) duplicates.push(event);
        events.add(event);
      }
    }

    expect(duplicates).toEqual([]);
  });

  it('all consumed events are published by a registered module', () => {
    const publishedEvents = new Set(REGISTERED_MODULES.flatMap((m) => m.publishes));

    for (const module of REGISTERED_MODULES) {
      for (const event of module.consumes) {
        expect(publishedEvents.has(event)).toBe(true);
      }
    }
  });

  it('CRM has no dependencies', () => {
    const crm = REGISTERED_MODULES.find((m) => m.key === 'crm')!;
    expect(crm.dependsOn).toEqual([]);
  });

  it('Inventory has no dependencies', () => {
    const inventory = REGISTERED_MODULES.find((m) => m.key === 'inventory')!;
    expect(inventory.dependsOn).toEqual([]);
  });

  it('POS depends on Inventory', () => {
    const pos = REGISTERED_MODULES.find((m) => m.key === 'pos')!;
    expect(pos.dependsOn).toEqual(['inventory']);
  });

  it('all modules have valid i18n name and description keys', () => {
    for (const module of REGISTERED_MODULES) {
      expect(module.nameKey).toMatch(/^modules\./);
      expect(module.descriptionKey).toMatch(/^modules\./);
    }
  });

  it('all modules have a stripePriceKey', () => {
    for (const module of REGISTERED_MODULES) {
      expect(module.stripePriceKey).toBeTruthy();
      expect(typeof module.stripePriceKey).toBe('string');
    }
  });

  it('all modules have trialDays >= 0', () => {
    for (const module of REGISTERED_MODULES) {
      expect(module.trialDays).toBeGreaterThanOrEqual(0);
    }
  });

  it('all permissions in each module match the module key prefix', () => {
    for (const module of REGISTERED_MODULES) {
      for (const perm of module.permissions) {
        expect(perm.startsWith(`${module.key}:`)).toBe(true);
      }
    }
  });

  it('all published events match the module key prefix', () => {
    for (const module of REGISTERED_MODULES) {
      for (const event of module.publishes) {
        expect(event.startsWith(`${module.key}.`)).toBe(true);
      }
    }
  });

  it('each module has at least one navigation item', () => {
    for (const module of REGISTERED_MODULES) {
      expect(module.navigation.length).toBeGreaterThan(0);
    }
  });

  it('each module has at least one permission', () => {
    for (const module of REGISTERED_MODULES) {
      expect(module.permissions.length).toBeGreaterThan(0);
    }
  });

  it('no two modules provide the same port token', () => {
    const provided = new Set<string>();
    const duplicates: string[] = [];

    for (const module of REGISTERED_MODULES) {
      for (const port of module.providesPorts) {
        if (provided.has(port.token)) duplicates.push(port.token);
        provided.add(port.token);
      }
    }

    expect(duplicates).toEqual([]);
  });

  it('all consumed ports are provided by a registered module', () => {
    const providedTokens = new Set(REGISTERED_MODULES.flatMap((m) => m.providesPorts.map((p) => p.token)));

    for (const module of REGISTERED_MODULES) {
      for (const port of module.consumesPorts) {
        expect(providedTokens.has(port.token)).toBe(true);
      }
    }
  });

  it('every consumed transactional port is provided as transactional', () => {
    const providedPorts = new Map<string, boolean>();
    for (const module of REGISTERED_MODULES) {
      for (const port of module.providesPorts) {
        providedPorts.set(port.token, port.transactional);
      }
    }

    for (const module of REGISTERED_MODULES) {
      for (const port of module.consumesPorts) {
        if (port.transactional) {
          expect(providedPorts.get(port.token)).toBe(true);
        }
      }
    }
  });

  it('INVENTORY_STOCK_PORT is provided by inventory and consumed by pos', () => {
    const inventory = REGISTERED_MODULES.find((m) => m.key === 'inventory')!;
    const pos = REGISTERED_MODULES.find((m) => m.key === 'pos')!;

    expect(inventory.providesPorts.map((p) => p.token)).toContain('INVENTORY_STOCK_PORT');
    expect(pos.consumesPorts.map((p) => p.token)).toContain('INVENTORY_STOCK_PORT');
  });
});
