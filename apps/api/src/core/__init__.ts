/**
 * Core shared kernel barrel.
 *
 * The core/ directory contains stable, module-agnostic shared kernel services.
 * Modules and platform code may import from here.
 *
 * @see ARCHITECTURE.md §3 — core/
 * @see ARCHITECTURE.md §3 — Import legality matrix
 */

export * from './database/__init__.js';
export * from './tenancy/__init__.js';
export * from './auth/__init__.js';
export * from './authorization/__init__.js';
export * from './events/__init__.js';
export * from './entitlements/__init__.js';
export * from './observability/__init__.js';
export * from './common/__init__.js';
export * from './audit/__init__.js';
export * from './i18n/__init__.js';
export * from './cache/__init__.js';
export * from './jobs/__init__.js';
export * from './storage/__init__.js';
export * from './notifications/__init__.js';
