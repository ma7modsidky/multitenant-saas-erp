'use client';

import { useEffect } from 'react';

/**
 * Registers the POS PWA service worker (public/sw.js) on the app shell.
 *
 * Mounted in the root layout so every page is controlled: the SW precaches
 * the static shell, caches hashed build assets (SWR), and serves cached
 * navigations — or /offline.html — when the network is gone (Phase 6.7).
 *
 * Registration is progressive enhancement: a failure (or an unsupported
 * browser) leaves the app fully functional online, so it is deliberately
 * silent. The SW itself calls skipWaiting + clients.claim, so a fresh deploy
 * takes over on the next load without a manual refresh.
 */
export function SwRegister() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
    // SW requires a secure context; localhost and loopback IPs are treated as
    // secure (dev / seeded e2e run against http://127.0.0.1:3000 too).
    const host = window.location.hostname;
    const isSecure =
      window.location.protocol === 'https:' || host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
    if (!isSecure) return;
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Offline-first is an enhancement, never a requirement — stay silent.
    });
  }, []);

  return null;
}
