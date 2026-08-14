import { NextResponse, type NextRequest } from 'next/server';
import createMiddleware from 'next-intl/middleware';

import { isLocale, routing } from './i18n/routing';
import { AUTH_COOKIE } from './lib/auth/session';

/**
 * Auth guard + next-intl locale middleware.
 *
 * - Auth pages (login/signup/forgot/reset) are off-limits once signed in.
 * - The locale root, /settings, /m/* and /dashboard require a session
 *   (mirrored by the non-sensitive `modubiz_authed` cookie; the real check
 *   still happens against the API on the client).
 * - Locale resolution is delegated to next-intl for everything else.
 */

const AUTH_ROUTES = ['/login', '/signup', '/forgot-password', '/reset-password'];
// Invitation acceptance is accessible without prior auth (invited users may not have an account).
const INVITATION_ROUTE_PREFIX = '/invitations/';

function isProtected(route: string): boolean {
  return route === '' || route === '/dashboard' || route.startsWith('/settings') || route.startsWith('/m/');
}

function resolveLocale(request: NextRequest): string {
  const pathname = request.nextUrl.pathname;
  const first = pathname.split('/')[1] ?? '';
  if (isLocale(first)) return first;
  const cookie = request.cookies.get('NEXT_LOCALE')?.value;
  if (cookie && isLocale(cookie)) return cookie;
  return 'en';
}

// next-intl v4: pass the shared routing config directly.
const intlMiddleware = createMiddleware(routing);

export default function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const segments = pathname.split('/').filter(Boolean);
  const first = segments[0] ?? '';
  const isLocalePath = isLocale(first);
  const route = isLocalePath ? `/${segments.slice(1).join('/')}` : pathname;
  const locale = resolveLocale(request);

  const isAuthed = request.cookies.get(AUTH_COOKIE)?.value === '1';
  const isAuthRoute = AUTH_ROUTES.includes(route);
  const isInvitationRoute = route.startsWith(INVITATION_ROUTE_PREFIX);

  if (isAuthed && isAuthRoute) {
    return NextResponse.redirect(new URL(`/${locale}`, request.url));
  }

  if (!isAuthed && !isAuthRoute && !isInvitationRoute && isProtected(route)) {
    return NextResponse.redirect(new URL(`/${locale}/login`, request.url));
  }

  return intlMiddleware(request);
}

export const config = {
  // Match all routes except static files and Next.js internals
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
