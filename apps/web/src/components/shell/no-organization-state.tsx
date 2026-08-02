'use client';

import { Building2, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';

import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';

/**
 * Empty state for org-scoped pages when the session has no active
 * organization (e.g. right after signup, before onboarding is complete).
 * Links to the dashboard, which hosts the create-organization form.
 */
export function NoOrganizationState() {
  const t = useTranslations();
  const locale = useLocale();

  return (
    <div className="mx-auto max-w-md py-12 animate-fade-in">
      <Card>
        <CardContent className="flex flex-col items-center gap-4 pt-8 pb-8 text-center">
          <div className="flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Building2 className="size-6" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-lg font-semibold tracking-tight">{t('org.onboardingTitle')}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t('org.onboardingSubtitle')}</p>
          </div>
          <Button asChild>
            <Link href={`/${locale}`}>
              {t('org.create')}
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
