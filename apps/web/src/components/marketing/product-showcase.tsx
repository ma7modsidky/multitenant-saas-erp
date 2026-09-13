'use client';

import { useTranslations } from 'next-intl';

import { LandingBadge } from './showcase-bits';

/**
 * Hero product showcase — a CSS-built dashboard mockup rather than a raster
 * screenshot: it stays crisp at any DPI, follows the light/dark theme
 * automatically (all colors are design tokens), mirrors correctly in RTL
 * (logical properties), localizes its labels via the landing catalog, and
 * adds zero image weight to the page.
 */
export function ProductShowcase() {
  const t = useTranslations('landing.showcase');

  const kpis: readonly { readonly key: string; readonly value: string }[] = [
    { key: 'revenue', value: '$48,200' },
    { key: 'deals', value: '127' },
    { key: 'lowStock', value: '3' },
    { key: 'invoices', value: '$12,840' },
  ];

  const stages: readonly { readonly key: string; readonly percent: number; readonly cards: readonly string[] }[] = [
    { key: 'new', percent: 45, cards: ['acme', 'globex'] },
    { key: 'qualified', percent: 60, cards: ['initech', 'umbrella', 'hooli'] },
    { key: 'won', percent: 100, cards: ['stark'] },
  ];

  return (
    <div
      role="img"
      aria-label={t('alt')}
      className="relative mx-auto w-full max-w-5xl overflow-hidden rounded-xl border bg-card shadow-2xl"
    >
      {/* Window chrome */}
      <div className="flex items-center gap-2 border-b bg-muted/60 px-4 py-2.5">
        <span className="size-2.5 rounded-full bg-red-400" />
        <span className="size-2.5 rounded-full bg-amber-400" />
        <span className="size-2.5 rounded-full bg-green-400" />
        <span className="ms-3 rounded-sm bg-background px-2 py-0.5 text-xs text-muted-foreground">
          app.modubiz.example/{'{locale}'}/dashboard
        </span>
      </div>

      <div className="flex" aria-hidden="true">
        {/* Sidebar */}
        <div className="hidden w-44 shrink-0 flex-col gap-1 border-e bg-muted/30 p-3 sm:flex">
          <div className="mb-2 flex items-center gap-2 px-1">
            <span className="flex size-6 items-center justify-center rounded bg-primary text-[10px] font-bold text-primary-foreground">
              M
            </span>
            <span className="text-xs font-semibold">ModuBiz</span>
          </div>
          {['nav.dashboard', 'nav.crm', 'nav.inventory', 'nav.pos', 'nav.accounting', 'nav.purchasing'].map((key) => (
            <div key={key} className="flex items-center gap-2 rounded px-2 py-1.5 text-xs text-muted-foreground">
              <span className="size-2 rounded-sm bg-primary/40" />
              {t(key)}
            </div>
          ))}
        </div>

        {/* Main panel */}
        <div className="flex-1 p-4">
          {/* KPI cards */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {kpis.map(({ key, value }) => (
              <div key={key} className="rounded-lg border bg-background p-3">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{t(`kpi.${key}`)}</p>
                <p className="mt-1 text-base font-bold">{value}</p>
              </div>
            ))}
          </div>

          {/* Pipeline board */}
          <div className="mt-3 rounded-lg border bg-background p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-semibold">{t('pipeline.title')}</p>
              <LandingBadge>{t('pipeline.winRate')}</LandingBadge>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {stages.map((stage) => (
                <div key={stage.key} className="rounded-md bg-muted/50 p-2">
                  <div className="mb-1.5 flex items-center justify-between gap-1">
                    <span className="truncate text-[10px] font-medium text-muted-foreground">
                      {t(`stage.${stage.key}`)}
                    </span>
                    <span className="text-[10px] font-bold text-success">{stage.percent}%</span>
                  </div>
                  {/* Stage success bar (CRM-17) */}
                  <div className="mb-2 h-1 w-full overflow-hidden rounded-full bg-border">
                    <div className="h-full rounded-full bg-success" style={{ width: `${stage.percent}%` }} />
                  </div>
                  <div className="space-y-1.5">
                    {stage.cards.map((card) => (
                      <div key={card} className="rounded border bg-card p-1.5 text-[10px] font-medium shadow-sm">
                        {card}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
