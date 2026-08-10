import { PosInstallPrompt } from '@/features/pos/install-prompt';
import { OfflinePosProvider, PosOfflineBadge } from '@/features/pos/offline';

/**
 * POS route group — every /m/pos page shares the offline engine: the provider
 * tracks connectivity + outbox counts and auto-flushes on reconnect (POS-28),
 * the floating badge keeps the connection state visible (UI §9.2), and the
 * install prompt surfaces the installable-PWA affordance (UI §9).
 */
export default function PosLayout({ children }: { children: React.ReactNode }) {
  return (
    <OfflinePosProvider>
      {children}
      <PosOfflineBadge />
      <PosInstallPrompt />
    </OfflinePosProvider>
  );
}
