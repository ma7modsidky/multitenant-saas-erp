// public/sw.js — ModuBiz POS service worker (Phase 6.7 PWA shell).
//
// Hand-rolled (no workbox — the stack is locked; see docs/TECH_STACK.md). The
// strategies are deliberately boring and robust for an offline-first POS:
//
//   install   → precache the static shell (offline.html, manifest, icons)
//   activate  → purge caches from older CACHE_VERSIONs; claim clients
//   navigate  → network-first, fall back to the exact cached page, then to
//               /offline.html (UI spec §9.2: the user is never blocked; the
//               offline state is always visible)
//   static    → hashed prod assets (_next/static) are immutable → serve cache
//               and revalidate in the background (SWR). Un-hashed DEV chunks
//               stay network-first so hot reload is never stale.
//   api       → NEVER cached: skip /v1/*, /api/*, RSC payloads, and any
//               request carrying an Authorization header.
//
// Deploy rule: bump CACHE_VERSION when the app shell changes so old caches are
// dropped on activate (the versioned name makes purge-by-prefix safe).
//
// eslint-disable — this file ships verbatim to /sw.js and is intentionally
// plain ES2020, outside the TypeScript project.

const CACHE_VERSION = 'v1';
const SHELL_CACHE = `modubiz-pos-shell-${CACHE_VERSION}`;
const STATIC_CACHE = `modubiz-pos-static-${CACHE_VERSION}`;
const PAGE_CACHE = `modubiz-pos-pages-${CACHE_VERSION}`;

/** The static shell — everything /offline.html needs to render on its own. */
const PRECACHE_URLS = [
  '/offline.html',
  '/manifest.webmanifest',
  '/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png',
];

/** Production chunks carry content hashes (page-abc123.js) — immutable, SWR-able. */
const HASHED_ASSET_RE = /\/_next\/static\/.+\.[0-9a-f]{8,}\.(?:js|css|woff2?)$/;

/** Requests that must NEVER touch a cache (data, not shell). */
function isApiLike(url, request) {
  if (url.pathname.startsWith('/v1/') || url.pathname.startsWith('/api/')) return true;
  if (url.searchParams.has('_rsc')) return true; // App Router RSC payloads
  if (request.headers.get('authorization')) return true;
  return false;
}

/** Cache-first with background revalidation — for immutable prod assets. */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  const refresh = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => cached);
  return cached ?? refresh;
}

/**
 * Network-first with cache fallback — fresh when online, cached when not.
 *
 * The successful response is AWAITED into the cache before it reaches the
 * page: for navigations this guarantees that once the load event fires, the
 * offline copy is durably stored (the offline e2e depends on this ordering —
 * a fire-and-forget put could race a dropped network and fall back to
 * /offline.html instead of the cached page).
 */
async function networkFirst(request, cacheName, fallbackUrl) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    if (fallbackUrl) {
      const shell = await caches.match(fallbackUrl);
      if (shell) return shell;
    }
    return new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => Promise.allSettled(PRECACHE_URLS.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) =>
                key.startsWith('modubiz-pos-') && key !== SHELL_CACHE && key !== STATIC_CACHE && key !== PAGE_CACHE,
            )
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // never touch the API origin
  if (isApiLike(url, request)) return;

  // Offline-first routing (UI spec §9.2): checkouts open with no network at all.
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, PAGE_CACHE, '/offline.html'));
    return;
  }

  // Hashed prod assets → SWR; dev chunks → network-first (no stale HMR).
  if (HASHED_ASSET_RE.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }
  if (url.pathname.startsWith('/_next/static') || url.pathname.startsWith('/_next/image')) {
    event.respondWith(networkFirst(request, STATIC_CACHE));
    return;
  }

  // Everything else same-origin GET (icons, manifest, robots) → SWR.
  event.respondWith(staleWhileRevalidate(request));
});
