'use client';

import { useQuery } from '@tanstack/react-query';
import { Building2, CreditCard, PackageOpen, Users, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { getAdminOverview } from '@/lib/api/resources';

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold tabular-nums">{value}</div>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

/** Module display name with fallback to the raw key (new modules may lack a catalog key). */
function moduleName(t: ReturnType<typeof useTranslations>, moduleKey: string): string {
  const key = `modules.${moduleKey}.name`;
  return t.has(key) ? t(key) : moduleKey;
}

export default function AdminOverviewPage() {
  const t = useTranslations();
  const { data, isLoading } = useQuery({ queryKey: ['admin-overview'], queryFn: getAdminOverview });

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('admin.overview.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('admin.overview.subtitle')}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {isLoading || !data ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)
        ) : (
          <>
            <StatCard icon={Building2} label={t('admin.overview.orgsTotal')} value={String(data.organizations.total)} />
            <StatCard icon={Users} label={t('admin.overview.totalUsers')} value={String(data.totalUsers)} />
            <StatCard
              icon={CreditCard}
              label={t('admin.overview.activeSubscriptions')}
              value={String(data.subscriptions.active)}
              hint={`${data.subscriptions.other} ${t('admin.overview.otherSubscriptions').toLowerCase()}`}
            />
            <StatCard
              icon={PackageOpen}
              label={t('admin.overview.moduleAdoption')}
              value={String(Object.keys(data.modulesEnabledByKey).length)}
            />
          </>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('admin.overview.orgsActive')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {isLoading || !data ? (
              <Skeleton className="h-6 w-full" />
            ) : (
              <>
                <div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{t('admin.overview.orgsActive')}</span>
                    <span className="font-medium tabular-nums">{data.organizations.active}</span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-all"
                      style={{
                        width: `${data.organizations.total > 0 ? (data.organizations.active / data.organizations.total) * 100 : 0}%`,
                      }}
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{t('admin.overview.orgsPendingDeletion')}</span>
                  <span className="font-medium tabular-nums">{data.organizations.pendingDeletion}</span>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('admin.overview.moduleAdoption')}</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading || !data ? (
              <Skeleton className="h-24 w-full" />
            ) : Object.keys(data.modulesEnabledByKey).length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('admin.overview.noModules')}</p>
            ) : (
              <ul className="space-y-2">
                {Object.entries(data.modulesEnabledByKey)
                  .sort(([, a], [, b]) => b - a)
                  .map(([moduleKey, count]) => (
                    <li key={moduleKey} className="flex items-center justify-between text-sm">
                      <span className="font-medium">{moduleName(t, moduleKey)}</span>
                      <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-medium tabular-nums">
                        {count}
                      </span>
                    </li>
                  ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
