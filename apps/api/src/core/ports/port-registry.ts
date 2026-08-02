import { Inject, Injectable } from '@nestjs/common';

import { type PortToken } from '@modubiz/contracts';

/**
 * PortRegistry — maps port tokens to their runtime implementations.
 *
 * Ports are declared in module descriptors (`providesPorts` / `consumesPorts`)
 * and wired at boot by the composition root (PLAN.md §3.4). The registry is
 * the single place that resolves a port token to an implementation so that a
 * consuming module never imports the providing module's source — it depends
 * only on the token + interface from `@modubiz/contracts`.
 *
 * Wiring:
 * - A module that PROVIDES a port registers its implementation here
 *   (typically in its Nest module class or the composition root).
 * - A module that CONSUMES a port injects `PortRegistry` and resolves the
 *   token — no import of the provider.
 *
 * @see PLAN.md §3.4 — Port registration infrastructure
 * @see ARCHITECTURE.md §6 — Level 2/3 ports
 */
@Injectable()
export class PortRegistry {
  private readonly ports = new Map<PortToken, unknown>();

  /**
   * Register an implementation for a port token.
   * Throws if the token is already registered — a duplicate provider is a
   * descriptor conflict and should have been caught by boot validation.
   */
  register(token: PortToken, implementation: unknown): void {
    if (this.ports.has(token)) {
      throw new Error(`Port "${token}" is already registered.`);
    }
    this.ports.set(token, implementation);
  }

  /**
   * Resolve the implementation registered for a port token.
   * @throws {Error} if the token has no registered implementation.
   */
  resolve<T>(token: PortToken): T {
    const implementation = this.ports.get(token);
    if (implementation === undefined) {
      throw new Error(`Port "${token}" is not registered.`);
    }
    return implementation as T;
  }

  /** Whether an implementation is registered for the token. */
  has(token: PortToken): boolean {
    return this.ports.has(token);
  }

  /** All currently registered port tokens (for introspection/tests). */
  get tokens(): PortToken[] {
    return [...this.ports.keys()];
  }
}
