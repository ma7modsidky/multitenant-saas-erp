// Shared helpers for the module generator.
// Plain Node ESM — no build step, no external dependencies.

import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Repository root (four levels up from tooling/generators/module/src). */
export const REPO_ROOT = join(__dirname, '..', '..', '..', '..');

/**
 * Validate a module key.
 * Rules: lowercase ASCII letters + digits, starts with a letter, 2–24 chars.
 * @throws {Error} on invalid input
 */
export function validateKey(key) {
  if (typeof key !== 'string' || key.trim() === '') {
    throw new Error('Usage: pnpm generate:module <key>');
  }
  if (!/^[a-z][a-z0-9]{1,23}$/.test(key)) {
    throw new Error(
      `Invalid module key "${key}". Use 2–24 lowercase letters/digits, starting with a letter (e.g. "demo", "crm", "fooddelivery").`,
    );
  }
  return key;
}

/** PascalCase of a snake-ish key: 'crm' -> 'Crm', 'food-delivery' -> 'FoodDelivery'. */
export function pascalCase(key) {
  return key
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

/** SCREAMING_SNAKE of a key: 'food-delivery' -> 'FOOD_DELIVERY'. */
export function screamingSnake(key) {
  return key
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .map((part) => part.toUpperCase())
    .join('_');
}

/**
 * Write a file (creating parent dirs). Skips with a message if the file exists
 * to avoid clobbering an existing module.
 */
export function writeFile(repoPath, content) {
  const absolute = join(REPO_ROOT, repoPath);
  if (existsSync(absolute)) {
    return { status: 'skipped', path: repoPath };
  }
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, 'utf8');
  return { status: 'created', path: repoPath };
}

/** Read a file as UTF-8; throws if missing. */
export function readFile(repoPath) {
  return readFileSync(join(REPO_ROOT, repoPath), 'utf8');
}

/** Confirm a file exists at a repo-relative path. */
export function fileExists(repoPath) {
  return existsSync(join(REPO_ROOT, repoPath));
}

/**
 * Overwrite an EXISTING file (used by the registration edits).
 * Unlike writeFile, this does not skip existing files.
 */
export function overwriteFile(repoPath, content) {
  const absolute = join(REPO_ROOT, repoPath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, 'utf8');
}

/** Format a log line consistently. */
export function log(message) {
  // The generator is a developer CLI; stdout is the intended output channel.
  // eslint-disable-next-line no-console
  console.log(message);
}

/** Format an error line consistently. */
export function logError(message) {
  // eslint-disable-next-line no-console
  console.error(message);
}
