'use client';

import { Check, Copy, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { AuditLogEntry } from '@/lib/api/types';

import { changedFields, entityLabel, formatValue, humanizeKey } from './format';

/** Semantic badge colors per audit action (Create green / Update blue / Delete red…). */
const ACTION_COLORS: Record<string, string> = {
  CREATE: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30',
  UPDATE: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30',
  DELETE: 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/30',
  SOFT_DELETE: 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/30',
  LOGIN: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30',
  LOGOUT: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30',
};

export function ActionBadge({ action }: { action: string }) {
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

/** Small copy-to-clipboard button with a transient "Copied" state. */
export function CopyIdButton({ value, compact = false }: { value: string; compact?: boolean }) {
  const t = useTranslations();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    // No Clipboard API (non-secure context) → nothing to copy; bail out so we
    // never show a false "Copied" state. The id stays selectable + in title.
    if (!navigator.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Write rejected (permissions) — the id stays selectable.
    }
  };

  return (
    <button
      type="button"
      onClick={() => void copy()}
      className={`inline-flex items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring ${
        compact ? 'size-5' : 'size-6'
      }`}
      aria-label={copied ? t('audit.copied') : t('audit.copyId')}
      title={copied ? t('audit.copied') : value}
    >
      {copied ? <Check className="size-3.5" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
    </button>
  );
}

/** Renders one snapshot value as diff-cell content (mono for raw/JSON values). */
function DiffCell({ value, locale }: { value: unknown; locale: string }) {
  const t = useTranslations();
  const text = formatValue(value, locale, { yes: t('audit.yes'), no: t('audit.no') });
  const isRaw = typeof value === 'object' && value !== null;
  return (
    <span className={isRaw ? 'block max-w-56 break-all font-mono text-xs text-muted-foreground' : undefined} dir="auto">
      {text}
    </span>
  );
}

interface AuditEntryDialogProps {
  entry: AuditLogEntry | null;
  /** Resolved actor display name (null/undefined → falls back to the stored id). */
  actorName?: string | null;
  onClose: () => void;
}

/**
 * AuditEntryDialog — per-entry detail view (the pattern Stripe/GitHub use):
 * the list stays scannable, the dialog shows the full field-level diff plus
 * traceability metadata (IP, correlation id) and a raw-JSON view for admins.
 *
 * Accessible modal: role="dialog", aria-modal, Escape closes, focus moves to
 * the panel on open (mirrors the shared ConfirmDialog overlay pattern).
 */
export function AuditEntryDialog({ entry, actorName, onClose }: AuditEntryDialogProps) {
  const t = useTranslations();
  const locale = useLocale();
  const [showRaw, setShowRaw] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!entry) return;
    setShowRaw(false);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    panelRef.current?.focus();
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [entry, onClose]);

  if (!entry) return null;

  const rows = changedFields(entry.before, entry.after);
  const hasSnapshots = entry.before !== null || entry.after !== null;
  const actorDisplay = actorName ?? entry.actorUserId ?? t('audit.system');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="audit-dialog-title"
    >
      {/* Backdrop — visual dismissal surface, hidden from assistive tech
          (the X button + Escape cover keyboard users). */}
      <button
        type="button"
        className="absolute inset-0 cursor-default bg-black/50"
        onClick={onClose}
        aria-hidden="true"
        tabIndex={-1}
        data-testid="audit-dialog-backdrop"
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        className="relative max-h-[85vh] w-full max-w-2xl overflow-y-auto outline-none animate-fade-in"
      >
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <CardTitle id="audit-dialog-title" className="flex flex-wrap items-center gap-2 text-base">
                  <ActionBadge action={entry.action} />
                  <span>{entityLabel(t, entry.entityType)}</span>
                </CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">
                  {new Date(entry.occurredAt).toLocaleString(locale)}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="-me-1 -mt-1 size-7"
                onClick={onClose}
                aria-label={t('audit.close')}
              >
                <X className="size-4" aria-hidden="true" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 pt-0">
            {/* Traceability metadata */}
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <div className="min-w-0">
                <dt className="text-xs text-muted-foreground">{t('audit.actor')}</dt>
                <dd className="truncate font-medium" dir="auto">
                  {actorDisplay}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs text-muted-foreground">{t('audit.entityId')}</dt>
                <dd className="flex items-center gap-1">
                  <span className="truncate font-mono text-xs text-muted-foreground" dir="ltr" title={entry.entityId}>
                    {entry.entityId}
                  </span>
                  <CopyIdButton value={entry.entityId} compact />
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs text-muted-foreground">{t('audit.ipAddress')}</dt>
                <dd className="truncate font-mono text-xs">{entry.ip ?? '—'}</dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs text-muted-foreground">{t('audit.correlationId')}</dt>
                <dd className="truncate font-mono text-xs" dir="ltr">
                  {entry.correlationId ?? '—'}
                </dd>
              </div>
            </dl>

            {/* Field-level diff */}
            <div>
              <h3 className="text-sm font-semibold">{t('audit.changes')}</h3>
              {rows.length > 0 ? (
                <div className="mt-2 overflow-x-auto rounded-md border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/40 text-start text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="px-3 py-2 text-start font-medium">{t('audit.field')}</th>
                        <th className="px-3 py-2 text-start font-medium">{t('audit.before')}</th>
                        <th className="px-3 py-2 text-start font-medium">{t('audit.after')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {rows.map((row) => (
                        <tr key={row.key} className="align-top">
                          <td className="whitespace-nowrap px-3 py-2 font-medium">{humanizeKey(row.key)}</td>
                          <td className="px-3 py-2 text-muted-foreground">
                            <DiffCell value={row.before} locale={locale} />
                          </td>
                          <td className="px-3 py-2">
                            <DiffCell value={row.after} locale={locale} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">{t('audit.noDetails')}</p>
              )}
            </div>

            {/* Raw JSON for admins/support */}
            {hasSnapshots && (
              <div>
                <Button variant="outline" size="sm" onClick={() => setShowRaw((v) => !v)} aria-expanded={showRaw}>
                  {showRaw ? t('audit.prettyView') : t('audit.rawJson')}
                </Button>
                {showRaw && (
                  <div className="mt-2 space-y-2">
                    {entry.before !== null && (
                      <pre className="max-h-56 overflow-auto rounded-md bg-muted/50 p-3 font-mono text-xs" dir="ltr">
                        {JSON.stringify(entry.before, null, 2)}
                      </pre>
                    )}
                    {entry.after !== null && (
                      <pre className="max-h-56 overflow-auto rounded-md bg-muted/50 p-3 font-mono text-xs" dir="ltr">
                        {JSON.stringify(entry.after, null, 2)}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
