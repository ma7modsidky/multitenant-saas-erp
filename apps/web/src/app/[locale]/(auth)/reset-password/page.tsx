'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState } from 'react';
import { Lock, Eye, EyeOff, CheckCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';

export default function ResetPasswordPage() {
  const t = useTranslations();
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    // TODO: Connect to auth API
    setTimeout(() => {
      setIsLoading(false);
      setSuccess(true);
    }, 1000);
  };

  if (success) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          <Card className="text-center">
            <CardContent className="pt-8 pb-6">
              <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-success/10 text-success">
                <CheckCircle className="size-6" />
              </div>
              <h2 className="mt-4 text-xl font-semibold">{t('auth.passwordResetSuccess')}</h2>
            </CardContent>
            <CardFooter className="justify-center border-t pt-4">
              <Button asChild>
                <Link href="/login">{t('auth.login')}</Link>
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
          <h1 className="mt-4 text-2xl font-bold tracking-tight">{t('auth.resetPasswordTitle')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('auth.resetPasswordSubtitle')}</p>
        </div>

        <Card>
          <CardContent className="pt-6">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="new-password">{t('auth.newPassword')}</Label>
                <div className="relative">
                  <Lock className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                  <Input
                    id="new-password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••••••"
                    className="ps-9 pe-9"
                    required
                    minLength={12}
                    autoComplete="new-password"
                    autoFocus
                  />
                  <button
                    type="button"
                    className="absolute end-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirm-password">{t('auth.confirmPassword')}</Label>
                <div className="relative">
                  <Lock className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                  <Input
                    id="confirm-password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••••••"
                    className="ps-9 pe-9"
                    required
                    minLength={12}
                    autoComplete="new-password"
                  />
                </div>
              </div>

              <p className="text-xs text-muted-foreground">{t('auth.passwordMinLength')}</p>

              <Button type="submit" className="w-full" loading={isLoading}>
                {t('auth.resetPassword')}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
