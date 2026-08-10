import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import manifest from '../manifest';

/**
 * PWA shell tests (Phase 6.7) — pin the installable contract: the manifest
 * references only files that actually exist in public/, the service worker is
 * present with the offline strategies, and /offline.html is fully
 * self-contained (it must render with zero network).
 */
const PUBLIC_DIR = join(process.cwd(), 'public');

describe('PWA web app manifest', () => {
  it('targets the POS checkout and runs standalone', () => {
    expect(manifest().name).toBe('ModuBiz POS');
    expect(manifest().display).toBe('standalone');
    expect(manifest().start_url).toBe('/en/m/pos/checkout');
    expect(manifest().theme_color).toBe('#0f1729');
  });

  it('references icons that exist on disk with the required sizes', () => {
    for (const icon of manifest().icons ?? []) {
      expect(icon.src, `icon ${icon.src} exists`).toSatisfy((src: string) => {
        const path = src.replace(/^\//, '');
        return existsSync(join(PUBLIC_DIR, path));
      });
      if (icon.sizes !== 'any') {
        expect(icon.sizes).toMatch(/^\d+x\d+$/);
      }
    }
    // Chrome installability requires at least one 192px+ icon.
    const bigEnough = (manifest().icons ?? []).some((icon) => {
      const [widthText = '0'] = (icon.sizes ?? '').split('x');
      return Number(widthText) >= 192 && existsSync(join(PUBLIC_DIR, icon.src.replace(/^\//, '')));
    });
    expect(bigEnough).toBe(true);
  });

  it('shortcuts point at real POS routes', () => {
    for (const shortcut of manifest().shortcuts ?? []) {
      expect(shortcut.url).toMatch(/^\/en\/m\/pos\//);
    }
  });
});

describe('service worker', () => {
  const sw = readFileSync(join(PUBLIC_DIR, 'sw.js'), 'utf8');

  it('registers the three lifecycle handlers', () => {
    expect(sw).toContain("addEventListener('install'");
    expect(sw).toContain("addEventListener('activate'");
    expect(sw).toContain("addEventListener('fetch'");
  });

  it('precaches the offline shell and uses a versioned cache name', () => {
    expect(sw).toContain("'/offline.html'");
    expect(sw).toMatch(/modubiz-pos-shell-\$\{CACHE_VERSION\}/);
    expect(sw).toContain("const CACHE_VERSION = 'v1'");
  });

  it('falls back to /offline.html for offline navigations', () => {
    expect(sw).toContain("networkFirst(request, PAGE_CACHE, '/offline.html')");
  });

  it('never caches API traffic or RSC payloads', () => {
    expect(sw).toContain("url.pathname.startsWith('/v1/')");
    expect(sw).toContain("url.searchParams.has('_rsc')");
    expect(sw).toContain("request.headers.get('authorization')");
  });
});

describe('offline fallback page', () => {
  const html = readFileSync(join(PUBLIC_DIR, 'offline.html'), 'utf8');

  it('exists and is fully self-contained (no external asset references)', () => {
    expect(existsSync(join(PUBLIC_DIR, 'offline.html'))).toBe(true);
    // No external stylesheets, scripts, images, or fonts — it must render with
    // zero network. Inline <style>/<script> are fine.
    expect(html).not.toMatch(/<link[^>]+href="(?!data:)/);
    expect(html).not.toMatch(/<script[^>]+src=/);
    expect(html).not.toMatch(/<img[^>]+src="(?!data:)/);
  });

  it('carries strings for all four supported locales', () => {
    // The inline locale map uses unquoted keys (`en: { title: … }`).
    for (const locale of ['en', 'ar', 'fr', 'es']) {
      expect(html).toMatch(new RegExp(`${locale}: \\{ title:`));
    }
  });
});
