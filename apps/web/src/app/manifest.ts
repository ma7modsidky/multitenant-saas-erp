import type { MetadataRoute } from 'next';

/**
 * Web app manifest (PWA shell, Phase 6.7) — makes the POS installable and
 * standalone. Next.js serves this at /manifest.webmanifest automatically and
 * links it from every page's <head>.
 *
 * The POS is the installable surface (UI_UX_GUIDELINES §9): start_url opens
 * checkout directly, display is standalone, and the brand navy comes from the
 * --primary design token (#0F1729).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: 'modubiz-pos',
    name: 'ModuBiz POS',
    short_name: 'ModuBiz POS',
    description: 'Point of sale that keeps selling even when the network drops.',
    start_url: '/en/m/pos/checkout',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#ffffff',
    theme_color: '#0f1729',
    lang: 'en',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
    ],
    shortcuts: [
      {
        name: 'Checkout',
        short_name: 'Sell',
        url: '/en/m/pos/checkout',
      },
      {
        name: 'Reports',
        short_name: 'Reports',
        url: '/en/m/pos/reports',
      },
    ],
  };
}
