import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { LoginForm } from '@/components/auth/auth-form';
import { Card, CardContent, CardFooter } from '@/components/ui/card';

export default async function LoginPage() {
  const t = await getTranslations();

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-md space-y-6">
        {/* Brand */}
        <div className="flex flex-col items-center text-center">
          <div className="flex size-10 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
            M
          </div>
          <h1 className="mt-4 text-2xl font-bold tracking-tight">{t('auth.loginTitle')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('auth.loginSubtitle')}</p>
        </div>

        <Card>
          <CardContent className="pt-6">
            <LoginForm />
          </CardContent>
          <CardFooter className="justify-center border-t pt-4">
            <p className="text-sm text-muted-foreground">
              {t('auth.noAccount')}{' '}
              <Link
                href="/signup"
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                {t('auth.signup')}
              </Link>
            </p>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
