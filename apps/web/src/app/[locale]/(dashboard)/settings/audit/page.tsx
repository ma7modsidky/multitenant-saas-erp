'use client';

import { useQuery } from '@tanstack/react-query';
import { FileSearch, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

import { AccessDenied } from '@/components/shell/access-denied';
import { NoOrganizationState } from '@/components/shell/no-organization-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectItem } from '@/components/ui/select';
import { getAuditLog } from '@/lib/api/resources';
import type { AuditLogEntry } from '@/lib/api/types';
import { useSession } from '@/lib/auth/session-context';
import { hasPermission } from '@/lib/permissions';

const PAGE_SIZE = 15;

// Filterable entity types and actions that appear in core_audit_log for the
// platform-management endpoints (AUD-1). Iterated to render the dropdowns —
// a readonly array type avoids an `as const` cast (no-restricted-syntax).
const ENTITY_TYPES: readonly string[] = ['invitation', 'membership', 'organization', 'organization_settings', 'role'];
const ACTIONS: readonly string[] = [
  'CREATE',
  'UPDATE',
  'DELETE',
  'SOFT_DELETE',
  'RESTORE',
  'LOGIN',
  'LOGOUT',
  'EXPORT',
  'IMPORT',
  'OTHER',
];

const ACTION_COLORS: Record<string, string> = {
  CREATE: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30',
  UPDATE: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30',
  DELETE: 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/30',
  SOFT_DELETE: 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/30',
  LOGIN: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30',
  LOGOUT: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30',
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

/** Compact one-line rendering of a before/after JSON snapshot (diff preview). */
function snapshotSummary(snapshot: Record<string, unknown> | null): string {
  if (!snapshot) return '—';
  const keys = Object.keys(snapshot);
  if (keys.length === 0) return '{}';
  return keys
    .slice(0, 3)
    .map((k) => {
      const v = snapshot[k];
      // String() on unknown may yield '[object Object]' for nested snapshots —
      // stringify objects instead (no-base-to-string).
      const rendered =
        typeof v === 'string'
          ? v
          : typeof v === 'number' || typeof v === 'boolean'
            ? String(v)
            : (JSON.stringify(v) ?? 'null');
      return `${k}: ${rendered}`;
    })
    .join(', ');
}

function ActionBadge({ action }: { action: string }) {
  const t = useTranslations();
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${
        ACTION_COLORS[action] ?? 'bg-secondary text-secondary-foreground border-transparent'
      }`}
    >
      {t(`audit.actions.${action}`)}
    </span>
  );
}

export default function AuditLogSettingsPage() {
  const t = useTranslations();
  const { organizationId, permissions } = useSession();

  const [entityType, setEntityType] = useState('');
  const [action, setAction] = useState('');
  const [actorUserId, setActorUserId] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [page, setPage] = useState(1);

  // Memoized: the query object is the react-query key — a fresh object every
  // render would re-run the query (and re-render) in a loop.
  const query = useMemo(
    () => ({
      ...(entityType !== '' ? { entityType } : {}),
      ...(action !== '' ? { action } : {}),
      ...(actorUserId !== '' ? { actorUserId } : {}),
      ...(fromDate !== '' ? { fromDate: new Date(fromDate).toISOString() } : {}),
      ...(toDate !== '' ? { toDate: new Date(`${toDate}T23:59:59.999`).toISOString() } : {}),
      page,
      pageSize: PAGE_SIZE,
    }),
    [entityType, action, actorUserId, fromDate, toDate, page],
  );

  const { data, isFetching } = useQuery({
    queryKey: ['audit-log', organizationId, query],
    queryFn: () => {
      if (organizationId === null) throw new Error('No organization selected');
      return getAuditLog(organizationId, query);
    },
    enabled: organizationId !== null,
  });

  if (organizationId === null) return <NoOrganizationState />;

  // AUTHZ-5/BUSINESS_RULES §3: audit log is OWNER/ADMIN-only. The backend
  // enforces this via @RequiresPermission('platform:audit:view'); this gate
  // covers direct-URL navigation by other roles (server-authoritative — UX only).
  if (!hasPermission(permissions, 'platform:audit:view')) return <AccessDenied />;

  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const entries = data?.entries ?? [];

  const resetFilters = () => {
    setEntityType('');
    setAction('');
    setActorUserId('');
    setFromDate('');
    setToDate('');
    setPage(1);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('settings.sections.audit')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('settings.descriptions.audit')}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileSearch className="size-4 text-muted-foreground" aria-hidden="true" />
            {t('audit.title')}
          </CardTitle>
          <CardDescription>{t('audit.subtitle')}</CardDescription>
        </CardHeader>
        <CardContent>
          {/* Filters */}
          <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <Select
              value={entityType}
              onValueChange={(v) => {
                setEntityType(v);
                setPage(1);
              }}
              placeholder={t('audit.allEntityTypes')}
              aria-label={t('audit.allEntityTypes')}
            >
              <SelectItem value="">{t('audit.allEntityTypes')}</SelectItem>
              {ENTITY_TYPES.map((type) => (
                <SelectItem key={type} value={type}>
                  {type}
                </SelectItem>
              ))}
            </Select>
            <Select
              value={action}
              onValueChange={(v) => {
                setAction(v);
                setPage(1);
              }}
              placeholder={t('audit.allActions')}
              aria-label={t('audit.allActions')}
            >
              <SelectItem value="">{t('audit.allActions')}</SelectItem>
              {ACTIONS.map((a) => (
                <SelectItem key={a} value={a}>
                  {t(`audit.actions.${a}`)}
                </SelectItem>
              ))}
            </Select>
            <div className="relative">
              <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <Input
                className="ps-9"
                placeholder={t('audit.actorPlaceholder')}
                value={actorUserId}
                onChange={(e) => {
                  setActorUserId(e.target.value);
                  setPage(1);
                }}
                aria-label={t('audit.actorPlaceholder')}
              />
            </div>
            <Input
              type="date"
              value={fromDate}
              onChange={(e) => {
                setFromDate(e.target.value);
                setPage(1);
              }}
              aria-label={t('audit.fromDate')}
            />
            <Input
              type="date"
              value={toDate}
              onChange={(e) => {
                setToDate(e.target.value);
                setPage(1);
              }}
              aria-label={t('audit.toDate')}
            />
          </div>

          {isFetching && <p className="mb-3 text-xs text-muted-foreground">{t('shell.loading')}</p>}

          {entries.length === 0 && !isFetching ? (
            <div className="py-10 text-center">
              <p className="text-sm text-muted-foreground">{t('audit.empty')}</p>
              {(entityType !== '' || action !== '' || actorUserId !== '' || fromDate !== '' || toDate !== '') && (
                <Button variant="outline" size="sm" className="mt-3" onClick={resetFilters}>
                  {t('audit.clearFilters')}
                </Button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-start text-sm">
                <thead>
                  <tr className="border-b text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="px-3 py-2 text-start font-medium">{t('audit.time')}</th>
                    <th className="px-3 py-2 text-start font-medium">{t('audit.actor')}</th>
                    <th className="px-3 py-2 text-start font-medium">{t('audit.action')}</th>
                    <th className="px-3 py-2 text-start font-medium">{t('audit.entity')}</th>
                    <th className="px-3 py-2 text-start font-medium">{t('audit.details')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {entries.map((entry: AuditLogEntry) => (
                    <tr key={entry.id} className="align-top">
                      <td className="whitespace-nowrap px-3 py-2.5 text-xs text-muted-foreground">
                        {formatDate(entry.occurredAt)}
                      </td>
                      <td className="max-w-40 px-3 py-2.5">
                        <p className="truncate text-xs font-medium">{entry.actorUserId ?? t('audit.system')}</p>
                        <p className="text-xs text-muted-foreground">{entry.actorType}</p>
                      </td>
                      <td className="px-3 py-2.5">
                        <ActionBadge action={entry.action} />
                      </td>
                      <td className="px-3 py-2.5">
                        <p className="text-xs font-medium">{entry.entityType}</p>
                        <p className="max-w-32 truncate font-mono text-xs text-muted-foreground">{entry.entityId}</p>
                      </td>
                      <td className="max-w-72 px-3 py-2.5">
                        <div className="space-y-0.5 text-xs">
                          {entry.before !== null && (
                            <p className="text-muted-foreground">
                              <span className="text-muted-foreground/70">{t('audit.before')}: </span>
                              {snapshotSummary(entry.before)}
                            </p>
                          )}
                          {entry.after !== null && (
                            <p className="text-muted-foreground">
                              <span className="text-muted-foreground/70">{t('audit.after')}: </span>
                              {snapshotSummary(entry.after)}
                            </p>
                          )}
                          {entry.before === null && entry.after === null && <span>—</span>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {total > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
              <p className="text-xs text-muted-foreground">
                {t('members.showingCount', {
                  from: String((page - 1) * PAGE_SIZE + 1),
                  to: String(Math.min(page * PAGE_SIZE, total)),
                  total: String(total),
                })}
              </p>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setPage(Math.max(1, page - 1))} disabled={page <= 1}>
                  {t('common.previous')}
                </Button>
                <span className="text-xs text-muted-foreground">
                  {t('members.pageOf', { page: String(page), pages: String(pageCount) })}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(Math.min(pageCount, page + 1))}
                  disabled={page >= pageCount}
                >
                  {t('common.next')}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
