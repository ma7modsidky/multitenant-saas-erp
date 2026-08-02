import { AuthShell } from '@/components/auth/auth-shell';

/**
 * Auth route group layout — wraps login/signup/forgot/reset/invitation pages
 * with the AuthShell top bar (brand + locale switcher).
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <AuthShell>{children}</AuthShell>;
}
