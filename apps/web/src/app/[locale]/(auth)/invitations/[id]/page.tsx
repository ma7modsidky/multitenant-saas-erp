'use client';

import { CheckCircle, UserPlus, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { ApiError } from '@/lib/api';
import { invitationErrorKey } from '@/lib/api/error-keys';
import { acceptInvitation } from '@/lib/api/resources';
import { logout } from '@/lib/auth';
import { sessionStore } from '@/lib/auth/session';

/**
 * Page states:
 * - `checking`: reading the local session before firing the accept call
 * - `needsAccount`: no session — accepting requires an account whose email
 *   matches the invitation (AUTH-3 / user_own_invitations RLS policy 0009)
 * - `wrongAccount`: a session exists but its email differs from the invited
 *   email — the user must log out and sign in with the invited address
 * - `accepting`: session present, accept call in flight
 * - `accepted`: success
 * - `error`: the invitation is expired/invalid or the call failed
 */
type PageState = 'checking' | 'needsAccount' | 'wrongAccount' | 'accepting' | 'accepted' | 'error';

/**
 * Normalize an email for a case-insensitive comparison (AUTH-1 semantics).
 * Used to detect a session whose account email differs from the invited email
 * before firing the accept call (which would 404 via the RLS policy 0009).
 */
function normalizeEmail(email: string | null | undefined): string {
  return (email ?? '').trim().toLowerCase();
}

export default function AcceptInvitationPage() {
  const t = useTranslations();
  const router = useRouter();
  const locale = useLocale();
  const params = useParams<{ id: string }>();
  const invitationId = params.id;

  const [pageState, setPageState] = useState<PageState>('checking');
  const [errorKey, setErrorKey] = useState<string>('invitations.errors.failed');
  // The invited email, carried in the link (?email=) so the signup/login forms
  // can pre-fill (and lock) it. AUTH-9: the invitation is bound to this address.
  const [invitedEmail, setInvitedEmail] = useState<string | null>(null);
  // Display-only invite metadata from the link (?name=&org=&role=) so the
  // invitee sees who they are being invited as and where BEFORE authenticating.
  // Display-only: the accept flow is server-authoritative (user_own_invitations
  // RLS policy 0009 + the invitation's persisted roleId), so a forged display
  // param can never change the assigned role.
  const [inviteName, setInviteName] = useState<string | null>(null);
  const [orgName, setOrgName] = useState<string | null>(null);
  const [roleName, setRoleName] = useState<string | null>(null);
  // Prevent double-invocation in React strict mode.
  const attempted = useRef(false);

  // The invitation page lives in the (auth) route group without the session
  // provider, so we read the stored token directly.
  const hasSession = useCallback(() => sessionStore.getAccessToken() !== null, []);

  const runAccept = useCallback(() => {
    setPageState('accepting');
    acceptInvitation(invitationId)
      .then(() => {
        setPageState('accepted');
        // Brief delay so the user sees the success message before redirect.
        setTimeout(() => {
          router.replace(`/${locale}`);
        }, 2000);
      })
      .catch(async (err: unknown) => {
        // 401: no valid session (token missing/expired) — the invitee must
        // sign in with the invited email first. Drop the stale local session
        // so the auth routes become reachable again: middleware redirects
        // authed users away from /login and /signup, so keeping the expired
        // token would dead-end the needsAccount CTAs. Awaited (not fire-
        // and-forget) so the modubiz_authed cookie is cleared before the
        // needsAccount CTAs render — otherwise a fast click would still be
        // bounced by middleware. logout() cannot reject: its only awaited
        // call is best-effort and try/caught.
        if (err instanceof ApiError && err.status === 401) {
          await logout();
          setPageState('needsAccount');
          return;
        }
        setErrorKey(invitationErrorKey(err));
        setPageState('error');
      });
  }, [invitationId, locale, router]);

  // Read the ?email= query param synchronously in the SAME effect that decides
  // whether to accept. The page is client-side and lives outside the
  // SessionProvider, so it can't rely on a server prop — and a separate
  // "read email" effect would leave the decision effect running with the email
  // still null on the first render (skipping the mismatch guard below).
  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;

    // The invited email, carried in the link (?email=) so the signup/login
    // forms can pre-fill (and lock) it. AUTH-9: the invitation is bound to
    // this address. Keep it in state for the CTA hrefs + invited-as line.
    const params = new URLSearchParams(window.location.search);
    const email = params.get('email');
    if (email) setInvitedEmail(email);
    const name = params.get('name');
    if (name) setInviteName(name);
    const org = params.get('org');
    if (org) setOrgName(org);
    const role = params.get('role');
    if (role) setRoleName(role);

    // Accepting an invitation requires authentication: the invitee must be
    // signed in with the email the invitation was sent to. A brand-new
    // invitee has no account yet, so gate on the session instead of letting
    // the API call fail with a raw 401.
    if (!hasSession()) {
      setPageState('needsAccount');
      return;
    }

    // AUTH-9: the invitation is bound to the invited email. If the signed-in
    // account uses a different address, the accept call would 404 (RLS policy
    // user_own_invitations only exposes the invitation to the invited email).
    // Catch it here and offer a way out — a logged-in user can't reach the
    // auth routes (middleware redirects them to the dashboard), so the
    // wrong-account state must include a logout CTA.
    // (Truthy check: `?email=` parses to '' which is not a real invited address.)
    if (email) {
      const sessionEmail = sessionStore.getUser()?.email ?? null;
      if (normalizeEmail(sessionEmail) !== normalizeEmail(email)) {
        setPageState('wrongAccount');
        return;
      }
    }

    runAccept();
  }, [hasSession, runAccept]);

  const handleRetry = () => {
    attempted.current = false;
    if (!hasSession()) {
      setPageState('needsAccount');
      return;
    }
    runAccept();
  };

  // Wrong-account escape hatch: drop the local session so the user lands on
  // the needsAccount state and can sign up / log in with the invited email.
  const handleLogout = async () => {
    await logout();
    setPageState('needsAccount');
  };

  // Session email for the wrong-account message (read at render; the page has
  // no SessionProvider, so we read the stored user directly).
  const currentEmail = sessionStore.getUser()?.email ?? '';

  // Return path for the signup/login redirect so the invitee lands back on
  // this link after authenticating (the page then auto-accepts).
  const returnTo = `/${locale}/invitations/${invitationId}`;
  // The invited email is carried into the auth forms so the signup email field
  // is pre-filled and locked to it (AUTH-3/AUTH-9).
  const emailQuery = invitedEmail ? `&email=${encodeURIComponent(invitedEmail)}` : '';
  const signupHref = `/${locale}/signup?next=${encodeURIComponent(returnTo)}${emailQuery}`;
  const loginHref = `/${locale}/login?next=${encodeURIComponent(returnTo)}${emailQuery}`;

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-md space-y-6">
        {/* Brand */}
        <div className="flex flex-col items-center text-center">
          <div className="flex size-10 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
            M
          </div>
          <h1 className="mt-4 text-2xl font-bold tracking-tight">{t('invitations.acceptTitle')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('invitations.acceptSubtitle')}</p>
        </div>

        <Card>
          <CardContent className="pt-8 pb-6 text-center">
            {/* Invite summary — who is invited, where, and to which role. Shown
                in every pre-accept state so the invitee knows what they are
                joining before (or while) authenticating. */}
            {(inviteName || orgName || roleName) && (
              <div className="mb-5 rounded-md border bg-muted/40 p-4 text-start">
                {inviteName && <p className="text-sm font-medium text-foreground">{inviteName}</p>}
                {invitedEmail && <p className="text-xs text-muted-foreground">{invitedEmail}</p>}
                {(orgName || roleName) && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {orgName && <span>{t('invitations.organization', { org: orgName })}</span>}
                    {orgName && roleName && <span className="mx-1">·</span>}
                    {roleName && <span>{t('invitations.role', { role: roleName })}</span>}
                  </p>
                )}
              </div>
            )}

            {(pageState === 'checking' || pageState === 'accepting') && (
              <div className="flex flex-col items-center gap-3">
                <div
                  className="size-8 animate-spin rounded-full border-4 border-muted border-t-primary"
                  aria-hidden="true"
                />
                <p className="text-sm text-muted-foreground" aria-live="polite">
                  {t('shell.loading')}
                </p>
              </div>
            )}

            {pageState === 'needsAccount' && (
              <div className="flex flex-col items-center gap-3">
                <UserPlus className="size-10 text-primary" aria-hidden="true" />
                <p className="text-sm font-medium">{t('invitations.needAccountTitle')}</p>
                <p className="text-sm text-muted-foreground">{t('invitations.needAccountSubtitle')}</p>
                {invitedEmail && (
                  <p className="text-sm font-medium text-foreground">
                    {t('invitations.invitedAs', { email: invitedEmail })}
                  </p>
                )}
                <div className="mt-2 flex w-full flex-col gap-2">
                  <Button asChild>
                    <Link href={signupHref}>{t('invitations.createAccount')}</Link>
                  </Button>
                  <Button variant="outline" asChild>
                    <Link href={loginHref}>{t('auth.login')}</Link>
                  </Button>
                </div>
              </div>
            )}

            {pageState === 'wrongAccount' && (
              <div className="flex flex-col items-center gap-3">
                <XCircle className="size-10 text-destructive" aria-hidden="true" />
                <p className="text-sm font-medium text-destructive" role="alert">
                  {t('invitations.wrongAccountTitle')}
                </p>
                <p className="text-sm text-muted-foreground">
                  {t('invitations.wrongAccountSubtitle', {
                    invitedEmail: invitedEmail ?? '',
                    currentEmail,
                  })}
                </p>
                <div className="mt-2 flex w-full flex-col gap-2">
                  <Button variant="outline" onClick={() => void handleLogout()}>
                    {t('auth.logout')}
                  </Button>
                </div>
              </div>
            )}

            {pageState === 'accepted' && (
              <div className="flex flex-col items-center gap-3">
                <CheckCircle className="size-10 text-emerald-600" aria-hidden="true" />
                <p className="text-sm font-medium text-emerald-600" role="status">
                  {t('invitations.accepted')}
                </p>
              </div>
            )}

            {pageState === 'error' && (
              <div className="flex flex-col items-center gap-3">
                <XCircle className="size-10 text-destructive" aria-hidden="true" />
                <p className="text-sm text-destructive" role="alert">
                  {t(errorKey)}
                </p>
              </div>
            )}
          </CardContent>

          {pageState === 'error' && (
            <CardFooter className="justify-center gap-4 border-t pt-4">
              <Button variant="outline" asChild>
                <Link href={loginHref}>{t('auth.login')}</Link>
              </Button>
              <Button onClick={handleRetry}>{t('common.retry')}</Button>
            </CardFooter>
          )}
        </Card>
      </div>
    </div>
  );
}
