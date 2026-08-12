'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Package, Users, DollarSign, Building2, TrendingUp, Wallet, Puzzle } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations, useLocale } from 'next-intl';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Combobox } from '@/components/ui/combobox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CrmRecentDealsWidget, CrmUpcomingActivitiesWidget } from '@/features/crm/dashboard-widgets';
import { useDealsList } from '@/features/crm/hooks';
import { InventoryLowStockWidget, InventoryStockValuationWidget } from '@/features/inventory/dashboard-widgets';
import { useCurrencies, useInventoryProducts } from '@/features/inventory/hooks';
import { formatMinorAmount } from '@/features/inventory/money';
import { usePosSales } from '@/features/pos/hooks';
import { ApiError } from '@/lib/api';
import { createOrganization, getActiveOrganization } from '@/lib/api/resources';
import { useSession } from '@/lib/auth/session-context';
import { useDashboardWidgets, useEntitlements, useNavigation } from '@/lib/entitlements';
import { useOrgLocalization } from '@/lib/hooks/use-org-localization';

const MODULE_ICONS: Record<string, typeof Package> = {
  crm: Users,
  inventory: Package,
  pos: DollarSign,
};

function errorKey(code: string): string {
  switch (code) {
    case 'ORG_SLUG_TAKEN':
      return 'org.errors.slugTaken';
    case 'NETWORK_ERROR':
      return 'auth.errors.network';
    case 'INTERNAL_ERROR':
      return 'auth.errors.server';
    default:
      return 'auth.errors.unknown';
  }
}

function CreateOrganizationForm({ onCreated }: { onCreated: (orgId: string) => Promise<void> }) {
  const t = useTranslations();
  const locale = useLocale();
  const {
    countryCode,
    baseCurrency,
    timezone,
    setBaseCurrency,
    setTimezone,
    countryOptions,
    currencyOptions,
    timezoneOptions,
    handleCountryChange,
  } = useOrgLocalization(locale, { countryCode: 'US', baseCurrency: 'USD', timezone: 'UTC' });

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);
    try {
      const org = await createOrganization({ name, slug, countryCode, timezone, baseCurrency });
      await onCreated(org.id);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(errorKey(err.code));
      } else {
        setError('auth.errors.unknown');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="org-name">{t('org.name')}</Label>
        <Input
          id="org-name"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (
              slug === '' ||
              slug ===
                name
                  .toLowerCase()
                  .replace(/[^a-z0-9]+/g, '-')
                  .replace(/^-+|-+$/g, '')
            ) {
              setSlug(
                e.target.value
                  .toLowerCase()
                  .replace(/[^a-z0-9]+/g, '-')
                  .replace(/^-+|-+$/g, ''),
              );
            }
          }}
          required
          autoComplete="organization"
          autoFocus
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="org-slug">{t('org.slug')}</Label>
        <Input
          id="org-slug"
          value={slug}
          onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, ''))}
          required
          pattern="^[a-z0-9][a-z0-9-]*[a-z0-9]$"
          minLength={2}
        />
        <p className="text-xs text-muted-foreground">{t('org.slugHint')}</p>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="org-country">{t('org.country')}</Label>
          <Combobox
            id="org-country"
            options={countryOptions}
            value={countryCode}
            onValueChange={handleCountryChange}
            placeholder={t('org.selectCountry')}
            searchPlaceholder={t('org.searchCountry')}
            emptyText={t('common.noResults')}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="org-currency">{t('org.currency')}</Label>
          <Combobox
            id="org-currency"
            options={currencyOptions}
            value={baseCurrency}
            onValueChange={setBaseCurrency}
            placeholder={t('org.selectCurrency')}
            searchPlaceholder={t('org.searchCurrency')}
            emptyText={t('common.noResults')}
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="org-timezone">{t('org.timezone')}</Label>
        <Combobox
          id="org-timezone"
          options={timezoneOptions}
          value={timezone}
          onValueChange={setTimezone}
          placeholder={t('org.selectTimezone')}
          searchPlaceholder={t('org.searchTimezone')}
          emptyText={t('common.noResults')}
        />
      </div>
      {error && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {t(error)}
        </p>
      )}
      <Button type="submit" className="w-full" loading={isSubmitting}>
        {t('org.create')}
      </Button>
    </form>
  );
}

export default function DashboardPage() {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { status, organizationId, switchOrg } = useSession();
  const { data: navigation } = useNavigation(organizationId !== null);
  const { data: dashboardWidgets } = useDashboardWidgets(organizationId !== null);
  const { data: billing } = useEntitlements();
  const { data: activeOrg } = useQuery({
    queryKey: ['organization', organizationId],
    queryFn: getActiveOrganization,
    enabled: organizationId !== null,
  });

  // Stat cards pull their values from the modules' existing read endpoints
  // (same pattern as the widget cards below). Queries are gated on the org's
  // entitlement so an unentitled module never 403s — it just shows the 0 +
  // hint state.
  const entitlements = billing?.entitlements ?? [];
  const hasModule = (moduleKey: string) =>
    entitlements.some((e) => e.moduleKey === moduleKey && ['active', 'trialing', 'past_due'].includes(e.state));

  // Revenue (MTD) range — the org's local dates, matching the sales reports
  // page's inclusive date-range semantics.
  const now = new Date();
  const isoDay = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const mtdFrom = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const mtdTo = isoDay(now);

  const { data: productsPage } = useInventoryProducts({ pageSize: 1 }, hasModule('inventory'));
  const { data: dealsPage } = useDealsList({ status: 'open', pageSize: 1 }, hasModule('crm'));
  // Revenue counts completed + partially_refunded sales only — the server-side
  // statuses filter excludes voided (no payment captured) and refunded sales.
  const { data: salesPage } = usePosSales(
    { fromDate: mtdFrom, toDate: mtdTo, status: 'completed,partially_refunded', pageSize: 1 },
    hasModule('pos'),
  );
  // ISO currency reference data (exponents) for the revenue stat formatting.
  const { data: currencies } = useCurrencies();

  // Net Revenue (MTD) = gross revenue − refunds issued in the month (exact
  // BigInt integer math, hard rule #3 — never floating-point money). The
  // server computes both Σs on the matching set, so the dashboard never sums
  // a page of rows.
  const revenueMinor = BigInt(salesPage?.totalAmountMinor ?? '0');
  const refundsMinor = BigInt(salesPage?.refundsAmountMinor ?? '0');
  const netRevenueMinor = (revenueMinor - refundsMinor).toString();

  // Org auto-selection (AUTHZ-5 UX) lives in ShellLayout, which wraps every
  // dashboard route — including direct /settings/* navigation. See
  // components/shell/shell-layout.tsx.
  const handleCreated = async (orgId: string) => {
    await switchOrg(orgId);
    await queryClient.invalidateQueries();
    router.refresh();
  };

  if (status === 'loading') {
    return <div className="animate-pulse space-y-4">{t('shell.loading')}</div>;
  }

  if (organizationId === null) {
    return (
      <div className="mx-auto max-w-md space-y-6 py-8">
        <div className="text-center">
          <div className="mx-auto flex size-10 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
            <Building2 className="size-5" aria-hidden="true" />
          </div>
          <h1 className="mt-4 text-xl font-bold tracking-tight">{t('org.onboardingTitle')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('org.onboardingSubtitle')}</p>
        </div>
        <Card>
          <CardContent className="pt-6">
            <CreateOrganizationForm onCreated={handleCreated} />
          </CardContent>
        </Card>
      </div>
    );
  }

  const quickModules = (navigation ?? []).map((group) => {
    const first = group.items[0];
    return {
      moduleKey: group.moduleKey,
      labelKey: group.labelKey,
      href: first ? `/${locale}${first.href}` : `/${locale}`,
      icon: MODULE_ICONS[group.moduleKey] ?? Puzzle,
    };
  });

  const activeModules = entitlements.filter((e) => ['active', 'trialing', 'past_due'].includes(e.state)).length;

  const baseCurrency = activeOrg?.data?.baseCurrency ?? 'USD';
  const exponent = currencies?.find((c) => c.code === baseCurrency)?.exponent ?? 2;

  // Widgets are registered by modules (PLAN §3.3) and served by
  // GET /v1/me/dashboard/widgets — the dashboard never hardcodes a widget list.
  const registeredWidgets = (dashboardWidgets ?? []).flatMap((group) =>
    group.widgets.map((widget) => ({
      ...widget,
      moduleKey: group.moduleKey,
      icon: MODULE_ICONS[group.moduleKey] ?? Puzzle,
    })),
  );

  // Widget CONTENT is keyed by module + widget id. Modules that have shipped
  // a renderer (CRM, Inventory) get live data; not-yet-implemented widgets
  // keep the neutral placeholder until their module ships one.
  const renderWidgetContent = (moduleKey: string, widgetId: string) => {
    if (moduleKey === 'crm') {
      if (widgetId === 'recent-deals') return <CrmRecentDealsWidget />;
      if (widgetId === 'upcoming-activities') return <CrmUpcomingActivitiesWidget />;
    }
    if (moduleKey === 'inventory') {
      if (widgetId === 'low-stock') return <InventoryLowStockWidget />;
      if (widgetId === 'stock-valuation') return <InventoryStockValuationWidget />;
    }
    return <p className="text-xs text-muted-foreground">{t('dashboard.widgetPlaceholder')}</p>;
  };

  // Module stat cards render only when the module is active — an org with no
  // modules sees just the Active Modules card. The same entitlement source
  // drives this and the widget grid below, so the two never drift apart (an
  // unentitled module's queries stay disabled and its card is hidden).
  const stats = [
    {
      label: t('dashboard.stats.activeModules'),
      value: String(activeModules),
      icon: Puzzle,
      change: t('dashboard.stats.modulesHint'),
    },
    ...(hasModule('inventory')
      ? [
          {
            label: t('dashboard.stats.products'),
            value: String(productsPage?.total ?? 0),
            icon: Package,
            change: t('dashboard.stats.startInventory'),
          },
        ]
      : []),
    ...(hasModule('pos')
      ? [
          {
            label: t('dashboard.stats.revenueMtd'),
            // Σ of the month's sale totals (server-side, minor units) for
            // completed + partially_refunded sales — voided (no payment
            // captured) and fully refunded sales never count. Note this is
            // GROSS: a partially_refunded sale still contributes its full
            // original total (refunds are separate records, same as the
            // shift report).
            value: formatMinorAmount(salesPage?.totalAmountMinor ?? '0', baseCurrency, { locale, exponent }),
            icon: TrendingUp,
            // With sales, the hint says so explicitly — the gross figure is
            // what makes this card different from Net Revenue below.
            change: revenueMinor > 0n ? t('dashboard.stats.revenueGrossHint') : t('dashboard.stats.startSelling'),
          },
          {
            label: t('dashboard.stats.netRevenueMtd'),
            value: formatMinorAmount(netRevenueMinor, baseCurrency, { locale, exponent }),
            icon: Wallet,
            // Net = gross − refunds issued this month (server-side Σ). With
            // refunds, show them; with none but sales, say the number equals
            // Revenue (explains the duplicate-looking card); otherwise
            // neutral.
            change:
              refundsMinor > 0n
                ? t('dashboard.stats.netRevenueHint', {
                    refunds: formatMinorAmount(refundsMinor.toString(), baseCurrency, { locale, exponent }),
                  })
                : revenueMinor > 0n
                  ? t('dashboard.stats.netRevenueNoRefundsHint')
                  : t('dashboard.stats.netRevenueZeroHint'),
          },
        ]
      : []),
    ...(hasModule('crm')
      ? [
          {
            label: t('dashboard.stats.activeDeals'),
            value: String(dealsPage?.total ?? 0),
            icon: DollarSign,
            change: t('dashboard.stats.dealsHint'),
          },
        ]
      : []),
  ];

  // Module gating makes the card count vary (1–5); size the lg grid to the
  // count so a lone Active Modules card doesn't sit in an empty 5-column row.
  const statsGridCols =
    stats.length >= 5
      ? 'lg:grid-cols-5'
      : stats.length === 4
        ? 'lg:grid-cols-4'
        : stats.length === 3
          ? 'lg:grid-cols-3'
          : 'lg:grid-cols-2';

  return (
    <div className="space-y-8 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('nav.dashboard')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {activeOrg?.data?.name ? `${activeOrg.data.name} · ${t('dashboard.welcome')}` : t('dashboard.welcome')}
        </p>
      </div>

      <div className={`grid gap-4 sm:grid-cols-2 ${statsGridCols}`}>
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <Card key={stat.label} className="transition-colors hover:bg-accent/30">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-muted-foreground">{stat.label}</p>
                  <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
                </div>
                <p className="mt-2 text-2xl font-bold tracking-tight">{stat.value}</p>
                <p className="mt-1 text-xs text-muted-foreground">{stat.change}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{t('nav.modulesLabel')}</h2>
          <Link
            href={`/${locale}/settings/modules`}
            className="flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            {t('nav.modules')}
            <ArrowRight className="size-3.5" />
          </Link>
        </div>

        {quickModules.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('dashboard.noModulesTitle')}</CardTitle>
              <CardDescription>{t('dashboard.noModulesHint')}</CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {quickModules.map((mod) => {
              const Icon = mod.icon;
              return (
                <Link key={mod.moduleKey} href={mod.href}>
                  <Card className="group cursor-pointer transition-all duration-200 hover:shadow-md hover:-translate-y-0.5">
                    <CardContent className="p-5">
                      <div className="flex items-start gap-4">
                        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                          <Icon className="size-5" aria-hidden="true" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <h3 className="font-semibold transition-colors group-hover:text-primary">
                            {t(mod.labelKey)}
                          </h3>
                          <p className="mt-0.5 text-sm text-muted-foreground line-clamp-2">
                            {t(`modules.${mod.moduleKey}.description`)}
                          </p>
                        </div>
                        <ArrowRight className="mt-1 size-4 shrink-0 text-muted-foreground opacity-0 -translate-x-1 transition-all group-hover:opacity-100 group-hover:translate-x-0" />
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      <div>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{t('dashboard.widgetsTitle')}</h2>
        </div>
        {registeredWidgets.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('dashboard.noModulesTitle')}</CardTitle>
              <CardDescription>{t('dashboard.noModulesHint')}</CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {registeredWidgets.map((widget) => {
              const Icon = widget.icon;
              // Descriptors declare a column width; honor it on the card.
              const span = widget.width > 1 ? { gridColumn: `span ${widget.width}` } : undefined;
              return (
                <Card
                  key={widget.id}
                  className="transition-all duration-200 hover:shadow-md hover:-translate-y-0.5"
                  style={span}
                >
                  <CardContent className="p-5">
                    <div className="flex items-center gap-3">
                      <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                        <Icon className="size-4" aria-hidden="true" />
                      </div>
                      <p className="text-sm font-medium">{t(widget.titleKey)}</p>
                    </div>
                    <div className="mt-4">{renderWidgetContent(widget.moduleKey, widget.id)}</div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
