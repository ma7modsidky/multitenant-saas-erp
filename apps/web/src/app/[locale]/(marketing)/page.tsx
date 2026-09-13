import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';

import { LandingPage } from '@/components/marketing/landing-page';

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
const SUPPORTED = ['en', 'ar', 'fr', 'es'];

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('landing');
  const locale = await getLocale();

  const title = t('hero.title');
  const description = t('hero.subtitle');

  // hreflang alternates — one entry per supported locale plus x-default.
  const languages: Record<string, string> = { 'x-default': '/en' };
  for (const l of SUPPORTED) languages[l] = `/${l}`;

  return {
    metadataBase: new URL(BASE_URL),
    title,
    description,
    alternates: {
      canonical: `/${locale}`,
      languages,
    },
    openGraph: {
      type: 'website',
      url: `/${locale}`,
      siteName: 'ModuBiz',
      title,
      description,
      locale,
      // Cross-posted locales so a Spanish visitor sees an es share.
      alternateLocale: SUPPORTED.filter((l) => l !== locale),
      // The route's opengraph-image.tsx (1200×630, localized) is picked up
      // automatically; declaring images here would override it.
      images: [{ url: `/${locale}/opengraph-image`, width: 1200, height: 630, alt: title }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [`/${locale}/opengraph-image`],
    },
  };
}

export default function LandingRoute() {
  return <LandingPage />;
}
