import type { LucideIcon } from 'lucide-react';
import {
  ArrowRight,
  ClipboardCheck,
  FileText,
  Lock,
  Package,
  ShieldCheck,
  Sparkles,
  Store,
  Truck,
  UserCog,
  Users,
  UtensilsCrossed,
  Wallet,
  Globe,
} from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';

import { ProductShowcase } from './product-showcase';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';

/**
 * Public marketing landing page.
 *
 * Content comes entirely from the `landing` i18n namespace (en/ar/fr/es —
 * Arabic renders RTL automatically via the locale layout). Sections are
 * anchored to the ids used by the topbar/footer nav: #product, #modules,
 * #how, #testimonials.
 *
 * Server-rendered and static: no session, no API calls, no client state.
 */
export async function LandingPage() {
  const t = await getTranslations('landing');
  const locale = await getLocale();
  const signupHref = `/${locale}/signup`;
  const loginHref = `/${locale}/login`;

  interface ModuleCard {
    key: string;
    icon: LucideIcon;
    available: boolean;
  }

  const MODULES: readonly ModuleCard[] = [
    { key: 'crm', icon: Users, available: true },
    { key: 'inventory', icon: Package, available: true },
    { key: 'pos', icon: Store, available: true },
    { key: 'accounting', icon: FileText, available: true },
    { key: 'purchasing', icon: Truck, available: true },
    { key: 'ecommerce', icon: Globe, available: false },
    { key: 'food', icon: UtensilsCrossed, available: false },
    { key: 'hr', icon: UserCog, available: false },
  ];

  interface PillarCard {
    key: string;
    icon: LucideIcon;
  }

  const PILLARS: readonly PillarCard[] = [
    { key: 'modular', icon: Wallet },
    { key: 'isolation', icon: ShieldCheck },
    { key: 'intl', icon: Globe },
    { key: 'audit', icon: ClipboardCheck },
  ];

  const STEPS: readonly string[] = ['step1', 'step2', 'step3', 'step4'];
  const TESTIMONIALS: readonly string[] = ['t1', 't2', 't3'];

  return (
    <div>
      {/* ─── Hero ─────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden border-b bg-gradient-to-b from-primary/5 to-transparent">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-6 px-4 py-20 text-center sm:px-6 md:py-28">
          <Badge variant="secondary" className="gap-1.5 px-3 py-1 text-xs">
            <Sparkles className="size-3.5" aria-hidden="true" />
            {t('hero.badge')}
          </Badge>

          <h1 className="max-w-3xl text-balance text-4xl font-bold tracking-tight md:text-5xl">{t('hero.title')}</h1>

          <p className="max-w-2xl text-pretty text-base text-muted-foreground md:text-lg">{t('hero.subtitle')}</p>

          <div className="flex flex-col items-center gap-3 sm:flex-row">
            <Link
              href={signupHref}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
            >
              {t('hero.ctaPrimary')}
              <ArrowRight className="size-4 rtl:rotate-180" aria-hidden="true" />
            </Link>
            <Link
              href={loginHref}
              className="inline-flex h-10 items-center justify-center rounded-md border border-input bg-background px-6 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              {t('hero.ctaSecondary')}
            </Link>
          </div>

          <p className="text-xs text-muted-foreground">{t('hero.trialNote')}</p>

          {/* Stats strip */}
          <dl className="mt-6 grid w-full max-w-2xl grid-cols-3 gap-4 border-t pt-6">
            <div className="flex flex-col items-center gap-1">
              <dt className="sr-only">{t('hero.statModules')}</dt>
              <dd className="text-2xl font-bold md:text-3xl">8+</dd>
              <dd className="text-xs text-muted-foreground md:text-sm">{t('hero.statModules')}</dd>
            </div>
            <div className="flex flex-col items-center gap-1">
              <dt className="sr-only">{t('hero.statLanguages')}</dt>
              <dd className="text-2xl font-bold md:text-3xl">4</dd>
              <dd className="text-xs text-muted-foreground md:text-sm">{t('hero.statLanguages')}</dd>
            </div>
            <div className="flex flex-col items-center gap-1">
              <dt className="sr-only">{t('hero.statTrial')}</dt>
              <dd className="text-2xl font-bold md:text-3xl">14</dd>
              <dd className="text-xs text-muted-foreground md:text-sm">{t('hero.statTrial')}</dd>
            </div>
          </dl>
        </div>

        {/* Product showcase — a themed dashboard mockup (see component docs:
            crisp at any DPI, follows light/dark, mirrors in RTL). */}
        <div className="mx-auto w-full max-w-6xl px-4 pb-16 sm:px-6 md:pb-24">
          <ProductShowcase />
        </div>
      </section>

      {/* ─── Pillars (#product) ───────────────────────────────────────────── */}
      <section id="product" className="scroll-mt-16 border-b bg-muted/40">
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 md:py-24">
          <div className="mx-auto mb-10 max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight">{t('pillars.title')}</h2>
            <p className="mt-3 text-muted-foreground">{t('pillars.subtitle')}</p>
          </div>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {PILLARS.map(({ key, icon: Icon }) => (
              <Card key={key} className="border bg-card shadow-none">
                <CardContent className="flex flex-col gap-3 p-6">
                  <span className="flex size-10 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <Icon className="size-5" aria-hidden="true" />
                  </span>
                  <h3 className="font-semibold">{t(`pillars.${key}.title`)}</h3>
                  <p className="text-sm text-muted-foreground">{t(`pillars.${key}.body`)}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Modules (#modules) ───────────────────────────────────────────── */}
      <section id="modules" className="scroll-mt-16 border-b">
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 md:py-24">
          <div className="mx-auto mb-10 max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight">{t('modules.title')}</h2>
            <p className="mt-3 text-muted-foreground">{t('modules.subtitle')}</p>
          </div>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {MODULES.map(({ key, icon: Icon, available }) => (
              <Card key={key} className={`border bg-card shadow-none ${available ? '' : 'opacity-75'}`}>
                <CardContent className="flex flex-col gap-3 p-6">
                  <div className="flex items-start justify-between">
                    <span className="flex size-10 items-center justify-center rounded-md bg-primary/10 text-primary">
                      <Icon className="size-5" aria-hidden="true" />
                    </span>
                    <Badge variant={available ? 'default' : 'outline'} className="text-xs">
                      {available ? t('modules.statusAvailable') : t('modules.statusPlanned')}
                    </Badge>
                  </div>
                  <h3 className="font-semibold">{t(`modules.${key}.name`)}</h3>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {t(`modules.${key}.tagline`)}
                  </p>
                  <p className="text-sm text-muted-foreground">{t(`modules.${key}.body`)}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* ─── How it works (#how) ──────────────────────────────────────────── */}
      <section id="how" className="scroll-mt-16 border-b bg-muted/40">
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 md:py-24">
          <div className="mx-auto mb-10 max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight">{t('how.title')}</h2>
            <p className="mt-3 text-muted-foreground">{t('how.subtitle')}</p>
          </div>

          <ol className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((key, index) => (
              <li key={key}>
                <Card className="h-full border bg-card shadow-none">
                  <CardContent className="flex flex-col gap-3 p-6">
                    <span className="flex size-8 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                      {index + 1}
                    </span>
                    <h3 className="font-semibold">{t(`how.${key}.title`)}</h3>
                    <p className="text-sm text-muted-foreground">{t(`how.${key}.body`)}</p>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ─── Testimonials (#testimonials) ─────────────────────────────────── */}
      <section id="testimonials" className="scroll-mt-16 border-b">
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 md:py-24">
          <div className="mx-auto mb-10 max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight">{t('testimonials.title')}</h2>
            <p className="mt-3 text-muted-foreground">{t('testimonials.subtitle')}</p>
          </div>

          <div className="grid gap-6 md:grid-cols-3">
            {TESTIMONIALS.map((key) => (
              <Card key={key} className="border bg-card shadow-none">
                <CardContent className="flex h-full flex-col gap-4 p-6">
                  <blockquote className="text-sm leading-relaxed">“{t(`testimonials.${key}.quote`)}”</blockquote>
                  <div className="mt-auto border-t pt-4">
                    <p className="text-sm font-semibold">{t(`testimonials.${key}.author`)}</p>
                    <p className="text-xs text-muted-foreground">{t(`testimonials.${key}.company`)}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <p className="mt-6 flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
            <Lock className="size-3.5" aria-hidden="true" />
            {t('testimonials.sampleNote')}
          </p>
        </div>
      </section>

      {/* ─── Final CTA ────────────────────────────────────────────────────── */}
      <section className="bg-gradient-to-b from-transparent to-primary/5">
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 md:py-24">
          <div className="mx-auto flex max-w-3xl flex-col items-center gap-6 rounded-xl border bg-card p-8 text-center shadow-sm md:p-12">
            <h2 className="text-3xl font-bold tracking-tight">{t('finalCta.title')}</h2>
            <p className="text-muted-foreground">{t('finalCta.subtitle')}</p>
            <div className="flex flex-col items-center gap-3 sm:flex-row">
              <Link
                href={signupHref}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
              >
                {t('finalCta.primary')}
                <ArrowRight className="size-4 rtl:rotate-180" aria-hidden="true" />
              </Link>
              <Link
                href={loginHref}
                className="inline-flex h-10 items-center justify-center rounded-md border border-input bg-background px-6 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                {t('finalCta.secondary')}
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
