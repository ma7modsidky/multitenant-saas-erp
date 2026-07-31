import { redirect } from 'next/navigation';

/**
 * Root locale page — redirects to login.
 *
 * In Phase 2, after authentication flow is built:
 * - Authenticated users → redirect to /[locale]/dashboard
 * - Unauthenticated users → redirect to /[locale]/login
 *
 * For now, we redirect to login since auth is not wired yet.
 */
export default function RootLocalePage() {
  redirect('/en/login');
}
