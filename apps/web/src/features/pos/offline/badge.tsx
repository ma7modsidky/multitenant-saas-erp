'use client';

import { AlertTriangle, CheckCircle2, Loader2, WifiOff } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';

import { useOfflinePos } from './context';

/**
 * POS connection badge (UI_UX_GUIDELINES §9.2) — always visible, never hidden.
 *
 *   Offline  → amber "Offline · N to sync"
 *   Syncing  → spinner "Syncing…"
 *   Sync err → red "N failed to sync" with a Retry button
 *   Synced   → brief green "Synced" after a flush that landed sales
 *   Queued   → muted "N queued — will sync" while waiting to send
 */
export function PosOfflineBadge() {
  const t = useTranslations('modules.pos');
  const { isOnline, pendingCount, failedCount, syncing, justSynced, retry } = useOfflinePos();

  // Fully online with nothing pending — nothing to show (the "Synced" toast is
  // the only transient state rendered while connected).
  if (isOnline && pendingCount === 0 && !justSynced) return null;

  let content: React.ReactNode;
  let className = 'bg-muted text-muted-foreground';

  if (!isOnline) {
    className = 'bg-amber-500/15 text-amber-700 dark:text-amber-400';
    content = (
      <>
        <WifiOff className="size-3.5 shrink-0" aria-hidden="true" />
        <span>{t('offline.badgeOffline', { count: pendingCount })}</span>
      </>
    );
  } else if (syncing) {
    className = 'bg-muted text-muted-foreground';
    content = (
      <>
        <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden="true" />
        <span>{t('offline.badgeSyncing')}</span>
      </>
    );
  } else if (failedCount > 0) {
    className = 'bg-destructive/10 text-destructive';
    content = (
      <>
        <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
        <span>{t('offline.badgeFailed', { count: failedCount })}</span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={() => void retry()}
          aria-label={t('offline.retry')}
        >
          {t('offline.retry')}
        </Button>
      </>
    );
  } else if (justSynced) {
    className = 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400';
    content = (
      <>
        <CheckCircle2 className="size-3.5 shrink-0" aria-hidden="true" />
        <span>{t('offline.synced')}</span>
      </>
    );
  } else {
    content = (
      <>
        <span>{t('offline.badgeQueued', { count: pendingCount })}</span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={() => void retry()}
          aria-label={t('offline.retry')}
        >
          {t('offline.retry')}
        </Button>
      </>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed bottom-4 end-4 z-50 flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium shadow-sm backdrop-blur ${className}`}
    >
      {content}
    </div>
  );
}
