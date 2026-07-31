'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState } from 'react';
import { Mail, ArrowLeft, CheckCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';

export default function ForgotPasswordPage() {
  const t = useTranslations();
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    // TODO: Connect to auth API
    setTimeout(() => {
      setIsLoading(false);
      setSent(true);
    }, 1000);
  };

  if (sent) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          <Card className="text-center">
            <CardContent className="pt-8 pb-6">
              <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-success/10 text-success">
                <CheckCircle className="size-6" />
              </div>
              <h2 className="mt-4 text-xl font-semibold">{t('auth.checkEmail')}</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {t('auth.checkEmailText', { email })}
              </p>
            </CardContent>
            <CardFooter className="justify-center border-t pt-4">
              <Button variant="ghost" asChild>
                <Link href="/login">
                  <ArrowLeft className="size-4 me-1" />
                  {t('auth.login')}
                </Link>
              </Button>
            </CardFooter>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-md space-y-6">
        <div className="flex flex-col items-center text-center">
          <div className="flex size-10 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
            M
          </div>
          <h1 className="mt-4 text-2xl font-bold tracking-tight">{t('auth.forgotPasswordTitle')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('auth.forgotPasswordSubtitle')}</p>
        </div>

        <Card>
          <CardContent className="pt-6">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="forgot-email">{t('auth.email')}</Label>
                <div className="relative">
                  <Mail className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                  <Input
                    id="forgot-email"
                    type="email"
                    placeholder="name@example.com"
                    className="ps-9"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                    autoFocus
                  />
                </div>
              </div>
              <Button type="submit" className="w-full" loading={isLoading}>
                {t('auth.resetPassword')}
              </Button>
            </form>
          </CardContent>
          <CardFooter className="justify-center border-t pt-4">
            <Button variant="ghost" asChild>
              <Link href="/login">
                <ArrowLeft className="size-4 me-1" />
                {t('auth.login')}
              </Link>
            </Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
