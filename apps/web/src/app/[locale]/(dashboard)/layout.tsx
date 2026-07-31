import { ShellLayout } from '@/components/shell/shell-layout';

/**
 * Dashboard layout — applies the app shell (sidebar + topbar)
 * to all dashboard routes.
 *
 * This route group does NOT include auth pages (login, signup, etc.)
 * which have their own simpler layout without the shell.
 */
export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <ShellLayout>{children}</ShellLayout>;
}
