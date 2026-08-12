'use client';

import { useQuery } from '@tanstack/react-query';
import { Download, Eye, FileSearch, Search } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
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
import { useMemberName } from '@/lib/hooks/use-member-name';
import { hasPermission } from '@/lib/permissions';

import { ActionBadge, AuditEntryDialog, CopyIdButton } from './audit-entry-dialog';
import {
  auditEntryToRow,
  buildAuditCsv,
  columnHeaderKey,
  CSV_COLUMNS,
  downloadCsv,
  fetchAllAuditEntries,
  type AuditCsvContext,
} from './export';
import { changedFields, entityLabel as entityTypeLabel, formatValue, humanizeKey, shortId } from './format';

const PAGE_SIZE = 15;

// Every entity type that appears in core_audit_log (AUD-1) — iterated to
// render the filter dropdown with human labels (audit.entities.*).
const ENTITY_TYPES: readonly string[] = [
  'invitation',
  'membership',
  'organization',
  'organization_settings',
  'role',
  'register',
  'shift',
  'sale',
  'refund',
  'company',
  'activity',
  'contact',
  'deal',
  'product',
  'product_variant',
  'stock_movement',
  'reservation',
  'warehouse',
  'stock_count',
];
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

/**
 * Compact details-column summary: up to two changed fields with formatted
 * values ("SKU: ABC-1 → ABC-2"), then "+N more". The full diff lives in the
 * detail dialog — the table stays scannable.
 */
function DetailsSummary({ entry }: { entry: AuditLogEntry }) {
  const t = useTranslations();
  const locale = useLocale();
  const rows = changedFields(entry.before, entry.after);
  if (rows.length === 0) return <span>—</span>;

  const labels = { yes: t('audit.yes'), no: t('audit.no') };
  const preview = rows.slice(0, 2).map((row) => {
    const field = humanizeKey(row.key);
    const hasBefore = row.before !== null && row.before !== undefined;
    const hasAfter = row.after !== null && row.after !== undefined;
    if (hasBefore && hasAfter) {
      return `${field}: ${formatValue(row.before, locale, labels)} → ${formatValue(row.after, locale, labels)}`;
    }
    return `${field}: ${formatValue(hasAfter ? row.after : row.before, locale, labels)}`;
  });

  return (
    <div className="space-y-0.5">
      {preview.map((line) => (
        <p key={line} className="truncate text-xs">
          {line}
        </p>
      ))}
      {rows.length > 2 && (
        <p className="text-xs text-muted-foreground/70">{t('audit.moreFields', { count: String(rows.length - 2) })}</p>
      )}
    </div>
  );
}

/** Entity cell: human label + truncated id with a copy button (id hidden when unrecorded). */
function EntityCell({ entry }: { entry: AuditLogEntry }) {
  const t = useTranslations();
  const hasId = entry.entityId !== '' && entry.entityId !== 'unknown';
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium">{entityTypeLabel(t, entry.entityType)}</p>
      {hasId && (
        <p className="mt-0.5 inline-flex items-center gap-1">
          <span className="font-mono text-xs text-muted-foreground" dir="ltr" title={entry.entityId}>
            {shortId(entry.entityId)}
          </span>
          <CopyIdButton value={entry.entityId} compact />
        </p>
      )}
    </div>
  );
}

export default function AuditLogSettingsPage() {
  const t = useTranslations();
  const locale = useLocale();
  const { organizationId, permissions } = useSession();
  const memberName = useMemberName();

  const [entityType, setEntityType] = useState('');
  const [action, setAction] = useState('');
  const [actorUserId, setActorUserId] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [page, setPage] = useState(1);
  const [selectedEntry, setSelectedEntry] = useState<AuditLogEntry | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exported, setExported] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // The filter half of the query — shared by the table query (which adds
  // page/pageSize) and the CSV export (which walks ALL matching pages).
  const filters = useMemo(
    () => ({
      ...(entityType !== '' ? { entityType } : {}),
      ...(action !== '' ? { action } : {}),
      ...(actorUserId !== '' ? { actorUserId } : {}),
      ...(fromDate !== '' ? { fromDate: new Date(fromDate).toISOString() } : {}),
      ...(toDate !== '' ? { toDate: new Date(`${toDate}T23:59:59.999`).toISOString() } : {}),
    }),
    [entityType, action, actorUserId, fromDate, toDate],
  );

  // Memoized: the query object is the react-query key — a fresh object every
  // render would re-run the query (and re-render) in a loop.
  const query = useMemo(() => ({ ...filters, page, pageSize: PAGE_SIZE }), [filters, page]);

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

  const selectedActorName = selectedEntry
    ? (memberName(selectedEntry.actorUserId) ?? selectedEntry.actorUserId ?? null)
    : null;

  // Export ALL entries matching the current filters as a CSV with the same
  // humanized labels as the table (entity/action labels, formatted diffs).
  const handleExport = async () => {
    if (organizationId === null || isExporting) return;
    setIsExporting(true);
    setExportError(null);
    try {
      const allEntries = await fetchAllAuditEntries(organizationId, filters);
      const ctx: AuditCsvContext = {
        locale,
        labels: { yes: t('audit.yes'), no: t('audit.no') },
        actionLabel: (a) => t(`audit.actions.${a}`),
        entityLabel: (type) => entityTypeLabel(t, type),
        actorName: (userId) => (userId ? (memberName(userId) ?? userId) : t('audit.system')),
      };
      const csv = buildAuditCsv(
        CSV_COLUMNS.map((column) => t(columnHeaderKey(column))),
        allEntries.map((entry) => auditEntryToRow(entry, ctx)),
      );
      downloadCsv(`audit-log-${new Date().toISOString().slice(0, 10)}.csv`, csv);
      setExported(true);
      window.setTimeout(() => setExported(false), 2000);
    } catch {
      setExportError(t('audit.exportFailed'));
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('settings.sections.audit')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('settings.descriptions.audit')}</p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2 text-base">
                <FileSearch className="size-4 text-muted-foreground" aria-hidden="true" />
                {t('audit.title')}
              </CardTitle>
              <CardDescription>{t('audit.subtitle')}</CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={() => void handleExport()}
              disabled={isExporting || total === 0}
            >
              <Download className="size-4" aria-hidden="true" />
              {isExporting ? t('audit.exporting') : exported ? t('audit.exported') : t('audit.exportCsv')}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {exportError !== null && (
            <p role="alert" className="mb-3 text-sm text-destructive">
              {exportError}
            </p>
          )}
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
                  {entityTypeLabel(t, type)}
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
                    <th className="px-3 py-2 text-start font-medium">
                      <span className="sr-only">{t('audit.viewDetails')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {entries.map((entry: AuditLogEntry) => (
                    <tr
                      key={entry.id}
                      className="align-top cursor-pointer transition-colors hover:bg-accent/30"
                      onClick={() => setSelectedEntry(entry)}
                    >
                      <td className="whitespace-nowrap px-3 py-2.5 text-xs text-muted-foreground">
                        {new Date(entry.occurredAt).toLocaleString(locale)}
                      </td>
                      <td className="max-w-40 px-3 py-2.5">
                        {/* The audit record keeps the actor id (immutable —
                            names change); the UI resolves it to the member
                            name when still a member, and falls back to the
                            id for removed users so the record stays traceable. */}
                        <p className="truncate text-xs font-medium">
                          {entry.actorUserId ? (memberName(entry.actorUserId) ?? entry.actorUserId) : t('audit.system')}
                        </p>
                        <p className="text-xs text-muted-foreground">{entry.actorType}</p>
                      </td>
                      <td className="px-3 py-2.5">
                        <ActionBadge action={entry.action} />
                      </td>
                      <td className="px-3 py-2.5">
                        <EntityCell entry={entry} />
                      </td>
                      <td className="max-w-72 px-3 py-2.5">
                        <DetailsSummary entry={entry} />
                      </td>
                      <td className="px-3 py-2.5">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          aria-label={t('audit.viewDetails')}
                          aria-haspopup="dialog"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedEntry(entry);
                          }}
                        >
                          <Eye className="size-4" aria-hidden="true" />
                        </Button>
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

      <AuditEntryDialog entry={selectedEntry} actorName={selectedActorName} onClose={() => setSelectedEntry(null)} />
    </div>
  );
}
