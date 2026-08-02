'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Package, Users, DollarSign, Building2, TrendingUp, Puzzle } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations, useLocale } from 'next-intl';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Combobox } from '@/components/ui/combobox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api';
import { createOrganization, getActiveOrganization } from '@/lib/api/resources';
import { useSession } from '@/lib/auth/session-context';
import { useEntitlements, useNavigation } from '@/lib/entitlements';
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
  const { data: billing } = useEntitlements();
  const { data: activeOrg } = useQuery({
    queryKey: ['organization', organizationId],
    queryFn: getActiveOrganization,
    enabled: organizationId !== null,
  });

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

  const activeModules =
    billing?.entitlements?.filter((e) => ['active', 'trialing', 'past_due'].includes(e.state)).length ?? 0;

  const stats = [
    {
      label: t('dashboard.stats.activeModules'),
      value: String(activeModules),
      icon: Puzzle,
      change: t('dashboard.stats.modulesHint'),
    },
    { label: t('dashboard.stats.products'), value: '0', icon: Package, change: t('dashboard.stats.startInventory') },
    { label: t('dashboard.stats.revenueMtd'), value: '0', icon: TrendingUp, change: t('dashboard.stats.startSelling') },
    { label: t('dashboard.stats.activeDeals'), value: '0', icon: DollarSign, change: t('dashboard.stats.dealsHint') },
  ];

  return (
    <div className="space-y-8 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('nav.dashboard')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {activeOrg?.data?.name ? `${activeOrg.data.name} · ${t('dashboard.welcome')}` : t('dashboard.welcome')}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('dashboard.recentActivity')}</CardTitle>
          <CardDescription>{t('dashboard.recentActivitySubtitle')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <p className="text-sm text-muted-foreground">{t('dashboard.noActivity')}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
