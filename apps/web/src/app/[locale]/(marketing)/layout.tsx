import { Footer } from '@/components/marketing/footer';
import { MarketingTopbar } from '@/components/marketing/marketing-chrome';

/**
 * Marketing route group — the public landing page chrome.
 *
 * Deliberately OUTSIDE the (dashboard) group: no ShellLayout, no session
 * gate, no data fetching. The topbar is a client component that reads the
 * shared landing catalog itself; the footer is a server component.
 */
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col bg-background text-foreground">
      <MarketingTopbar />
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}
