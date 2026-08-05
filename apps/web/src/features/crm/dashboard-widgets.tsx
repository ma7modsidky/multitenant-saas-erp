'use client';

// CRM dashboard widgets — the content bodies rendered inside the platform
// dashboard cards registered by crm.descriptor.ts (PLAN §3.3). The dashboard
// page keys each registered widget id to a component here; the data comes
// from the module's existing read endpoints via the shared CRM hooks, so the
// cards share cache and invalidation with the module pages.

import { Calendar, CheckCircle2, Mail, Phone, type LucideIcon } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';

import { useActivitiesList, useCurrencies, useDealsList } from './hooks';
import { formatMinorAmount } from './money';

/** Skeleton rows shown while the widget's first query is loading. */
function WidgetSkeleton({ rows }: { rows: number }) {
  return (
    <div className="space-y-2" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-5 animate-pulse rounded-md bg-muted" />
      ))}
    </div>
  );
}

/** Short localized date for a due timestamp ('Aug 5'), or '' when absent. */
function formatDueDate(iso: string | null, locale: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
}

/** Recent deals — most recently updated first, with value in the deal's currency. */
export function CrmRecentDealsWidget() {
  const t = useTranslations();
  const locale = useLocale();
  const { data: currencies } = useCurrencies();
  const { data, isPending } = useDealsList({ sortBy: 'updatedAt', sortDir: 'desc', pageSize: 5 });

  return (
    <div className="space-y-1">
      {isPending && !data ? (
        <WidgetSkeleton rows={4} />
      ) : (data?.items.length ?? 0) === 0 ? (
        <p className="py-1 text-xs text-muted-foreground">{t('dashboard.widgets.recentDealsEmpty')}</p>
      ) : (
        <ul className="space-y-0.5">
          {(data?.items ?? []).slice(0, 5).map((deal) => (
            <li key={deal.id}>
              <Link
                href={`/${locale}/m/crm/deals/${deal.id}`}
                className="group flex items-center justify-between gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-accent/50"
              >
                <span className="min-w-0 flex-1 truncate text-sm font-medium group-hover:text-primary" dir="auto">
                  {deal.title}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {formatMinorAmount(deal.value.amountMinor, deal.value.currency, {
                    locale,
                    // Exponent-aware (JPY=0, KWD=3, …) like the deals table.
                    exponent: currencies?.find((c) => c.code === deal.value.currency)?.exponent ?? 2,
                  })}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <div className="pt-2">
        <Link href={`/${locale}/m/crm/deals`} className="text-xs font-medium text-primary hover:underline">
          {t('dashboard.widgets.viewAll')}
        </Link>
      </div>
    </div>
  );
}

const ACTIVITY_ICONS: Record<string, LucideIcon> = {
  call: Phone,
  meeting: Calendar,
  task: CheckCircle2,
  email: Mail,
};

/** Upcoming activities — open items, soonest due first. */
export function CrmUpcomingActivitiesWidget() {
  const t = useTranslations();
  const locale = useLocale();
  const { data, isPending } = useActivitiesList({ completed: false, pageSize: 5 });

  return (
    <div className="space-y-1">
      {isPending && !data ? (
        <WidgetSkeleton rows={4} />
      ) : (data?.items.length ?? 0) === 0 ? (
        <p className="py-1 text-xs text-muted-foreground">{t('dashboard.widgets.upcomingActivitiesEmpty')}</p>
      ) : (
        <ul className="space-y-0.5">
          {(data?.items ?? []).slice(0, 5).map((activity) => {
            const Icon = ACTIVITY_ICONS[activity.type] ?? CheckCircle2;
            const due = formatDueDate(activity.dueAt, locale);
            return (
              <li key={activity.id}>
                <Link
                  href={`/${locale}/m/crm/activities/${activity.id}`}
                  className="group flex items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-accent/50"
                >
                  <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium group-hover:text-primary" dir="auto">
                    {activity.subject}
                  </span>
                  {due && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{due}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <div className="pt-2">
        <Link href={`/${locale}/m/crm/activities`} className="text-xs font-medium text-primary hover:underline">
          {t('dashboard.widgets.viewAll')}
        </Link>
      </div>
    </div>
  );
}
