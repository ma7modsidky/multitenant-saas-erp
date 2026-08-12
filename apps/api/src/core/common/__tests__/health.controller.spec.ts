import { describe, expect, it } from 'vitest';

import { TENANCY_METADATA } from '../../tenancy/system-context.decorator.js';
import { HealthController } from '../health.controller.js';

describe('HealthController', () => {
  it('answers ok inside the standard data envelope', () => {
    const controller = new HealthController();
    expect(controller.health()).toEqual({ data: { status: 'ok' } });
  });

  it('is marked @PublicRoute so no auth or tenant context is required', () => {
    const isPublic = Reflect.getMetadata(TENANCY_METADATA.IS_PUBLIC, HealthController.prototype.health);
    expect(isPublic).toBe(true);
  });
});
