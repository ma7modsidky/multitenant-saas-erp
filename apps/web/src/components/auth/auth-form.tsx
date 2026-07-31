'use client';

import { Eye, EyeOff, Mail, Lock, User } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { ApiError } from '@/lib/api';
import { login, signup } from '@/lib/auth';

import { cn } from '../cn';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';

/**
 * Map an API error code to a stable i18n key under `auth.errors`.
 * Any unknown code falls back to a generic message.
 */
function errorKey(code: string): string {
  switch (code) {
    case 'USER_EMAIL_TAKEN':
      return 'auth.errors.emailTaken';
    case 'AUTH_INVALID_CREDENTIALS':
      return 'auth.errors.invalidCredentials';
    case 'AUTH_ACCOUNT_LOCKED':
      return 'auth.errors.accountLocked';
    case 'AUTH_EMAIL_NOT_VERIFIED':
      return 'auth.errors.emailNotVerified';
    case 'NETWORK_ERROR':
      return 'auth.errors.network';
    case 'INTERNAL_ERROR':
      return 'auth.errors.server';
    default:
      return 'auth.errors.unknown';
  }
}

// ─── Login Form ────────────────────────────────────────────────────────────

interface LoginFormProps {
  className?: string;
  onSuccess?: () => void;
}

export function LoginForm({ className, onSuccess }: LoginFormProps) {
  const t = useTranslations();
  const router = useRouter();
  const pathname = usePathname();
  const locale = pathname.split('/')[1] ?? 'en';
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    setSuccess(false);
    try {
      await login({ email, password });
      setSuccess(true);
      onSuccess?.();
      router.replace(`/${locale}`);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(errorKey(err.code));
      } else {
        setError('auth.errors.unknown');
      }
    } finally {
      setIsLoading(false);
    }
  };

  if (success) {
    return (
      <div className={cn('space-y-4', className)}>
        <div role="status" className="rounded-md bg-emerald-500/10 px-3 py-2 text-sm text-emerald-600">
          {t('auth.loginSuccess')}
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className={cn('space-y-4', className)}>
      <div className="space-y-2">
        <Label htmlFor="login-email">{t('auth.email')}</Label>
        <div className="relative">
          <Mail className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            id="login-email"
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

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="login-password">{t('auth.password')}</Label>
          <Link
            href="/forgot-password"
            className="text-xs text-muted-foreground underline-offset-4 hover:text-primary hover:underline"
          >
            {t('auth.forgotPassword')}
          </Link>
        </div>
        <div className="relative">
          <Lock className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            id="login-password"
            type={showPassword ? 'text' : 'password'}
            placeholder="••••••••••••"
            className="ps-9 pe-9"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
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

      {error && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {t(error)}
        </p>
      )}

      <Button type="submit" className="w-full" loading={isLoading}>
        {t('auth.login')}
      </Button>
    </form>
  );
}

// ─── Signup Form ───────────────────────────────────────────────────────────

interface SignupFormProps {
  className?: string;
  onSuccess?: () => void;
}

export function SignupForm({ className, onSuccess }: SignupFormProps) {
  const t = useTranslations();
  const router = useRouter();
  const pathname = usePathname();
  const locale = pathname.split('/')[1] ?? 'en';
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    setSuccess(false);
    try {
      await signup({ name, email, password });
      setSuccess(true);
      onSuccess?.();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(errorKey(err.code));
      } else {
        setError('auth.errors.unknown');
      }
    } finally {
      setIsLoading(false);
    }
  };

  if (success) {
    return (
      <div className={cn('space-y-4', className)}>
        <div role="status" className="rounded-md bg-emerald-500/10 px-3 py-2 text-sm text-emerald-600">
          {t('auth.signupSuccess')}
        </div>
        <Button type="button" className="w-full" variant="outline" onClick={() => router.push(`/${locale}/login`)}>
          {t('auth.login')}
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className={cn('space-y-4', className)}>
      <div className="space-y-2">
        <Label htmlFor="signup-name">{t('common.name')}</Label>
        <div className="relative">
          <User className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            id="signup-name"
            type="text"
            placeholder="John Doe"
            className="ps-9"
            required
            autoComplete="name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="signup-email">{t('auth.email')}</Label>
        <div className="relative">
          <Mail className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            id="signup-email"
            type="email"
            placeholder="name@example.com"
            className="ps-9"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="signup-password">{t('auth.password')}</Label>
        <div className="relative">
          <Lock className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            id="signup-password"
            type={showPassword ? 'text' : 'password'}
            placeholder="••••••••••••"
            className="ps-9 pe-9"
            required
            minLength={12}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
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
        <p className="text-xs text-muted-foreground">{t('auth.passwordMinLength')}</p>
      </div>

      {error && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {t(error)}
        </p>
      )}

      <Button type="submit" className="w-full" loading={isLoading}>
        {t('auth.signup')}
      </Button>

      <p className="text-xs text-muted-foreground text-center">
        {t('auth.terms')}
      </p>
    </form>
  );
}
