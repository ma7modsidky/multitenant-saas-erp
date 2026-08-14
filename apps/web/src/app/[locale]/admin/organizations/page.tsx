'use client';

import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { getAdminOrganizations, type AdminOrgSummary } from '@/lib/api/resources';

const PAGE_SIZE = 20;

function formatDate(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date);
}

function statusBadge(org: AdminOrgSummary, t: ReturnType<typeof useTranslations>) {
  switch (org.status) {
    case 'active':
      return <Badge>{t('admin.organizations.statusActive')}</Badge>;
    case 'suspended':
      return <Badge variant="destructive">{t('admin.organizations.statusSuspended')}</Badge>;
    case 'pending_deletion':
      return <Badge variant="outline">{t('admin.organizations.statusPendingDeletion')}</Badge>;
    default:
      return <Badge variant="outline">{org.status}</Badge>;
  }
}

function subscriptionBadge(status: string | null, t: ReturnType<typeof useTranslations>) {
  if (status === null) return <span className="text-muted-foreground">{t('admin.organizations.noSubscription')}</span>;
  if (status === 'active') return <Badge variant="secondary">{status}</Badge>;
  return <Badge variant="outline">{status}</Badge>;
}

export default function AdminOrganizationsPage() {
  const t = useTranslations();
  const locale = useLocale();
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const id = window.setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 350);
    return () => window.clearTimeout(id);
  }, [search]);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['admin-organizations', debouncedSearch, page],
    queryFn: () => getAdminOrganizations({ search: debouncedSearch, page, pageSize: PAGE_SIZE }),
  });

  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('admin.organizations.title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('admin.organizations.subtitle')}</p>
        </div>
        <div className="relative sm:w-72">
          <Search
            className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('admin.organizations.searchPlaceholder')}
            className="ps-9"
            aria-label={t('common.search')}
          />
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-start text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3 text-start font-medium">{t('admin.organizations.tableName')}</th>
                  <th className="px-4 py-3 text-start font-medium">{t('admin.organizations.tableStatus')}</th>
                  <th className="px-4 py-3 text-start font-medium">{t('admin.organizations.tableMembers')}</th>
                  <th className="px-4 py-3 text-start font-medium">{t('admin.organizations.tableSubscription')}</th>
                  <th className="px-4 py-3 text-start font-medium">{t('admin.organizations.tableModules')}</th>
                  <th className="px-4 py-3 text-start font-medium">{t('admin.organizations.tableCreated')}</th>
                  <th className="px-4 py-3 text-end font-medium">{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="px-4 py-3" colSpan={7}>
                        <Skeleton className="h-5 w-full" />
                      </td>
                    </tr>
                  ))
                ) : (data?.items ?? []).length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-sm text-muted-foreground">
                      {t('admin.organizations.empty')}
                    </td>
                  </tr>
                ) : (
                  (data?.items ?? []).map((org) => (
                    <tr key={org.id} className="border-b last:border-0 transition-colors hover:bg-accent/40">
                      <td className="px-4 py-3">
                        <Link
                          href={`/admin/organizations/${org.id}`}
                          className="font-medium text-primary hover:underline"
                        >
                          {org.name}
                        </Link>
                        <span className="block text-xs text-muted-foreground">{org.slug}</span>
                      </td>
                      <td className="px-4 py-3">{statusBadge(org, t)}</td>
                      <td className="px-4 py-3 tabular-nums">{org.memberCount}</td>
                      <td className="px-4 py-3">{subscriptionBadge(org.subscriptionStatus, t)}</td>
                      <td className="px-4 py-3 tabular-nums">{org.activeModuleCount}</td>
                      <td className="px-4 py-3 text-muted-foreground">{formatDate(org.createdAt, locale)}</td>
                      <td className="px-4 py-3 text-end">
                        <Button asChild variant="ghost" size="sm">
                          <Link href={`/admin/organizations/${org.id}`}>{t('admin.organizations.view')}</Link>
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between border-t px-4 py-3">
            <p className="text-xs text-muted-foreground">
              {data ? `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, data.total)} / ${data.total}` : '…'}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1 || isFetching}
                onClick={() => setPage((p) => p - 1)}
              >
                {t('common.previous')}
              </Button>
              <span className="text-xs text-muted-foreground">
                {page} / {pages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= pages || isFetching}
                onClick={() => setPage((p) => p + 1)}
              >
                {t('common.next')}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
