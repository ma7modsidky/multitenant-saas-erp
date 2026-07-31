'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState } from 'react';
import { Eye, EyeOff, Mail, Lock, User, Building2 } from 'lucide-react';

import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { cn } from '../cn';

// ─── Login Form ────────────────────────────────────────────────────────────

interface LoginFormProps {
  className?: string;
  onSuccess?: () => void;
}

export function LoginForm({ className }: LoginFormProps) {
  const t = useTranslations();
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    // TODO: Connect to auth API
    setTimeout(() => {
      setIsLoading(false);
    }, 1000);
  };

  return (
    <form onSubmit={handleSubmit} className={cn('space-y-4', className)}>
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

export function SignupForm({ className }: SignupFormProps) {
  const t = useTranslations();
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    // TODO: Connect to auth API
    setTimeout(() => {
      setIsLoading(false);
    }, 1500);
  };

  return (
    <form onSubmit={handleSubmit} className={cn('space-y-4', className)}>
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
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="signup-org">{t('auth.organizationName')}</Label>
        <div className="relative">
          <Building2 className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            id="signup-org"
            type="text"
            placeholder="Acme Inc."
            className="ps-9"
            required
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

      <Button type="submit" className="w-full" loading={isLoading}>
        {t('auth.signup')}
      </Button>

      <p className="text-xs text-muted-foreground text-center">
        {t('auth.terms')}
      </p>
    </form>
  );
}
