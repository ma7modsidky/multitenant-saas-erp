import { ImageResponse } from 'next/og';

import { en, es, fr } from '@modubiz/i18n';

/**
 * Open Graph share image — an explicit route handler at /{locale}/opengraph-image
 * (1200×630 PNG) so the URL emitted in the page's og:image meta is exactly the
 * URL that serves the bytes. This deliberately replaces Next's file-convention
 * `opengraph-image.tsx`, which in Next 15.5 registers the route under a
 * content-hash path (`/en/opengraph-image-<hash>`) without emitting the clean
 * alias — crawlers resolving `/en/opengraph-image` got a 404.
 *
 * Content is localized per `[locale]` for Latin-script locales (Arabic falls
 * back to English — see `catalogFor`), and uses the brand navy from the
 * design tokens.
 */

const CATALOGS = { en, fr, es };

/**
 * Catalog selection for the OG image. Latin-script locales render their own
 * language. Arabic falls back to the English card: the satori renderer behind
 * ImageResponse does not implement Arabic OpenType contextual shaping
 * ("lookupType: 5 - substFormat: 3 is not yet supported") and would 500 —
 * and the brand name plus module names (CRM, POS…) are Latin in the product
 * itself, so the English card is the correct fallback for shares.
 */
function catalogFor(locale: string) {
  switch (locale) {
    case 'fr':
      return CATALOGS.fr;
    case 'es':
      return CATALOGS.es;
    default:
      return CATALOGS.en;
  }
}

/** Brand navy — the --primary design token (UI_UX_GUIDELINES §2.1). */
const BRAND_NAVY = '#0f1729';
const BRAND_ACCENT = '#3b82f6';

const SIZE = { width: 1200, height: 630 };

interface OGRouteContext {
  params: Promise<{ locale: string }>;
}

export async function GET(_request: Request, { params }: OGRouteContext): Promise<Response> {
  // The locale is the dynamic [locale] segment this route lives under.
  const { locale } = await params;
  const landing = catalogFor(locale).landing;

  const title = landing.hero.title;
  const tagline = landing.brandTagline;
  const modules = [
    landing.modules.crm.name,
    landing.modules.inventory.name,
    landing.modules.pos.name,
    landing.modules.accounting.name,
    landing.modules.purchasing.name,
  ];

  return new ImageResponse(
    <div
      style={{
        height: '100%',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: BRAND_NAVY,
        color: '#f8fafc',
        padding: '72px',
      }}
    >
      {/* Brand row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          position: 'absolute',
          top: 56,
          left: 64,
        }}
      >
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: 12,
            backgroundColor: BRAND_ACCENT,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 28,
            fontWeight: 700,
          }}
        >
          M
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: 30, fontWeight: 700 }}>ModuBiz</span>
          <span style={{ fontSize: 18, color: '#94a3b8' }}>{tagline}</span>
        </div>
      </div>

      {/* Localized hero title */}
      <div
        style={{
          display: 'flex',
          fontSize: 56,
          fontWeight: 700,
          lineHeight: 1.15,
          maxWidth: 960,
          textAlign: 'center',
          marginTop: 40,
        }}
      >
        {title}
      </div>

      {/* Module chips */}
      <div style={{ display: 'flex', gap: 14, marginTop: 48 }}>
        {modules.map((name) => (
          <div
            key={name}
            style={{
              display: 'flex',
              padding: '10px 22px',
              borderRadius: 9999,
              border: '1px solid #334155',
              backgroundColor: '#1e293b',
              color: '#e2e8f0',
              fontSize: 22,
            }}
          >
            {name}
          </div>
        ))}
      </div>

      {/* Footer strip */}
      <div
        style={{
          display: 'flex',
          position: 'absolute',
          bottom: 56,
          fontSize: 22,
          color: '#94a3b8',
        }}
      >
        modubiz.app
      </div>
    </div>,
    SIZE,
  );
}
