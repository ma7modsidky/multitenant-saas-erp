'use client';

import { Building2, Users, Shield, CreditCard, ScrollText, Puzzle, User, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { useTranslations, useLocale } from 'next-intl';

import { Card, CardContent } from '@/components/ui/card';
import { useSession } from '@/lib/auth/session-context';
import { hasPermission } from '@/lib/permissions';

export default function SettingsPage() {
  const t = useTranslations();
  const locale = useLocale();
  const { permissions } = useSession();

  // AUTHZ-5/BUSINESS_RULES §3: platform-management settings are OWNER/ADMIN
  // only. Backend enforces via @RequiresPermission; this hub hides entries a
  // member cannot use (UX only).
  const canManageMembers = hasPermission(permissions, 'platform:members:invite');
  const canManageRoles = hasPermission(permissions, 'platform:roles:manage');
  const canManageBilling = hasPermission(permissions, 'platform:billing:manage');
  const canViewAudit = hasPermission(permissions, 'platform:audit:view');

  const sections = [
    { key: 'organization', href: `/${locale}/settings/organization`, icon: Building2 },
    ...(canManageMembers ? [{ key: 'members', href: `/${locale}/settings/members`, icon: Users }] : []),
    ...(canManageRoles ? [{ key: 'roles', href: `/${locale}/settings/roles`, icon: Shield }] : []),
    ...(canManageBilling ? [{ key: 'billing', href: `/${locale}/settings/billing`, icon: CreditCard }] : []),
    ...(canViewAudit ? [{ key: 'audit', href: `/${locale}/settings/audit`, icon: ScrollText }] : []),
    { key: 'modules', href: `/${locale}/settings/modules`, icon: Puzzle },
    { key: 'profile', href: `/${locale}/settings/profile`, icon: User },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('settings.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('settings.subtitle')}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sections.map((section) => {
          const Icon = section.icon;
          return (
            <Link key={section.key} href={section.href}>
              <Card className="group cursor-pointer transition-all duration-200 hover:shadow-md hover:-translate-y-0.5">
                <CardContent className="flex items-start gap-4 p-5">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="size-5" aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold transition-colors group-hover:text-primary">
                      {t(`settings.sections.${section.key}`)}
                    </h3>
                    <p className="mt-0.5 text-sm text-muted-foreground">{t(`settings.descriptions.${section.key}`)}</p>
                  </div>
                  <ArrowRight className="mt-1 size-4 shrink-0 text-muted-foreground opacity-0 -translate-x-1 transition-all group-hover:opacity-100 group-hover:translate-x-0" />
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
