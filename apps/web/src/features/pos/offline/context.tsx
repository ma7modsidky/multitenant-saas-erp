'use client';

import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

import { useSession } from '@/lib/auth/session-context';

import { flushOutbox, outboxCounts } from './outbox';

export interface OfflinePosState {
  /** True while the browser believes it has connectivity. */
  isOnline: boolean;
  /** Queued (pending + failed) sales for the active org — badge count. */
  pendingCount: number;
  /** Sales the server rejected — red badge with a retry affordance. */
  failedCount: number;
  /** A flush pass is in flight. */
  syncing: boolean;
  /** Timestamp of the last flush that synced at least one sale. */
  lastSyncedAt: number | null;
  /** True briefly after a flush synced sales (green "Synced" pill). */
  justSynced: boolean;
  /** Recompute the outbox counts for the active org. */
  refresh: () => Promise<void>;
  /** Flush the outbox now (manual retry / reconnect). */
  retry: () => Promise<void>;
}

const OfflinePosContext = createContext<OfflinePosState | null>(null);

/**
 * OfflinePosProvider — one per POS route group (mounted in the m/pos layout).
 *
 * Owns the connection state, the outbox counts, and the flush loop: pending
 * sales are sent in sold_at order the moment connectivity returns (POS-28),
 * on mount, and on demand (retry). The checkout queues sales through the same
 * outbox (POS-25).
 */
export function OfflinePosProvider({ children }: { children: ReactNode }) {
  const { organizationId } = useSession();
  const queryClient = useQueryClient();

  const [isOnline, setIsOnline] = useState(() => (typeof navigator !== 'undefined' ? navigator.onLine : true));
  const [pendingCount, setPendingCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [justSynced, setJustSynced] = useState(false);

  const flushingRef = useRef(false);
  const wasOnlineRef = useRef(isOnline);

  const refresh = useCallback(async () => {
    if (!organizationId) {
      setPendingCount(0);
      setFailedCount(0);
      return;
    }
    const counts = await outboxCounts(organizationId);
    setPendingCount(counts.pending);
    setFailedCount(counts.failed);
  }, [organizationId]);

  const retry = useCallback(async () => {
    if (!organizationId || flushingRef.current) return;
    flushingRef.current = true;
    setSyncing(true);
    try {
      const result = await flushOutbox(organizationId);
      if (result.synced > 0) {
        setLastSyncedAt(Date.now());
        setJustSynced(true);
        // Sales landed on the server — refresh POS queries (registers, reports).
        void queryClient.invalidateQueries({ queryKey: ['pos'] });
        window.setTimeout(() => setJustSynced(false), 3000);
      }
      await refresh();
    } finally {
      setSyncing(false);
      flushingRef.current = false;
    }
  }, [organizationId, refresh, queryClient]);

  // Track connectivity and flush the moment it returns (POS-28).
  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  // On connect / org change: refresh counts, and flush when connectivity just
  // came back (or the page loaded online with a non-empty outbox).
  useEffect(() => {
    void refresh();
    if (!organizationId || !isOnline) return;
    const transitioned = !wasOnlineRef.current;
    wasOnlineRef.current = isOnline;
    if (transitioned || pendingCount > 0) {
      void retry();
    }
  }, [isOnline, organizationId, refresh, retry, pendingCount]);

  return (
    <OfflinePosContext.Provider
      value={{ isOnline, pendingCount, failedCount, syncing, lastSyncedAt, justSynced, refresh, retry }}
    >
      {children}
    </OfflinePosContext.Provider>
  );
}

export function useOfflinePos(): OfflinePosState {
  const ctx = useContext(OfflinePosContext);
  if (ctx === null) {
    throw new Error('useOfflinePos must be used within an OfflinePosProvider');
  }
  return ctx;
}
