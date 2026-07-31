'use client';

import { CheckCircle, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { ApiError } from '@/lib/api';
import { acceptInvitation } from '@/lib/api/resources';

type PageState = 'accepting' | 'accepted' | 'error';

function mapError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'INVITATION_EXPIRED' || err.status === 410) {
      return 'invitations.errors.expired';
    }
    if (err.code === 'NOT_FOUND' || err.status === 404) {
      return 'invitations.errors.invalid';
    }
  }
  return 'invitations.errors.failed';
}

export default function AcceptInvitationPage() {
  const t = useTranslations();
  const router = useRouter();
  const locale = useLocale();
  const params = useParams<{ id: string }>();
  const invitationId = params.id;

  const [pageState, setPageState] = useState<PageState>('accepting');
  const [errorKey, setErrorKey] = useState<string>('invitations.errors.failed');
  // Prevent double-invocation in React strict mode.
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;

    acceptInvitation(invitationId)
      .then(() => {
        setPageState('accepted');
        // Brief delay so the user sees the success message before redirect.
        setTimeout(() => {
          router.replace(`/${locale}`);
        }, 2000);
      })
      .catch((err: unknown) => {
        setErrorKey(mapError(err));
        setPageState('error');
      });
  }, [invitationId, locale, router]);

  const handleRetry = () => {
    attempted.current = false;
    setPageState('accepting');
    acceptInvitation(invitationId)
      .then(() => {
        setPageState('accepted');
        setTimeout(() => {
          router.replace(`/${locale}`);
        }, 2000);
      })
      .catch((err: unknown) => {
        setErrorKey(mapError(err));
        setPageState('error');
      });
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
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
            {pageState === 'accepting' && (
              <div className="flex flex-col items-center gap-3">
                <div className="size-8 animate-spin rounded-full border-4 border-muted border-t-primary" aria-hidden="true" />
                <p className="text-sm text-muted-foreground" aria-live="polite">
                  {t('shell.loading')}
                </p>
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
                <Link href={`/${locale}/login`}>{t('auth.login')}</Link>
              </Button>
              <Button onClick={handleRetry}>{t('common.retry')}</Button>
            </CardFooter>
          )}
        </Card>
      </div>
    </div>
  );
}
