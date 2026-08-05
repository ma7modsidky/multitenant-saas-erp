'use client';

import { Activity, Building2, Handshake, Users } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { ModuleGate } from '@/lib/entitlements';

export default function CrmLayout({ children }: { children: React.ReactNode }) {
  const locale = useLocale();
  const t = useTranslations('modules.crm');
  const links = [
    { href: 'contacts', label: t('nav.contacts'), icon: Users },
    { href: 'companies', label: t('nav.companies'), icon: Building2 },
    { href: 'deals', label: t('nav.deals'), icon: Handshake },
    { href: 'activities', label: t('nav.activities'), icon: Activity },
  ];
  return (
    <ModuleGate moduleKey="crm">
      <div className="space-y-5">
        <nav aria-label={t('name')} className="flex gap-2 overflow-x-auto pb-1">
          {links.map(({ href, label, icon: Icon }) => (
            <Button key={href} asChild variant="outline" size="sm">
              <Link href={`/${locale}/m/crm/${href}`}>
                <Icon />
                {label}
              </Link>
            </Button>
          ))}
        </nav>
        {children}
      </div>
    </ModuleGate>
  );
}
