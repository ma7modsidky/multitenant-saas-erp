'use client';

import { ShieldX } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Card, CardContent } from '@/components/ui/card';

/**
 * AccessDenied — UX-only gate rendered when a signed-in user reaches a
 * settings page whose management permission they lack (e.g. a MEMBER
 * navigating directly to /settings/members).
 *
 * Server-authoritative (OPS-8): the backend enforces every action via
 * @RequiresPermission; this state only avoids showing a page the user cannot
 * use. The sidebar and settings hub already hide these entries — this covers
 * direct-URL navigation.
 */
export function AccessDenied() {
  const t = useTranslations();

  return (
    <div className="flex min-h-[50vh] items-center justify-center animate-fade-in">
      <Card className="w-full max-w-md">
        <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <ShieldX className="size-6" aria-hidden="true" />
          </div>
          <h1 className="text-lg font-semibold">{t('accessDenied.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('accessDenied.description')}</p>
        </CardContent>
      </Card>
    </div>
  );
}
