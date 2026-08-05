import { describe, expect, it } from 'vitest';

import { InventoryItem } from '../../domain/index.js';

describe('InventoryItem', () => {
  it('constructs an item with id and name', () => {
    const item = new InventoryItem('id-1', 'First item');
    expect(item.id).toBe('id-1');
    expect(item.name).toBe('First item');
  });
});
