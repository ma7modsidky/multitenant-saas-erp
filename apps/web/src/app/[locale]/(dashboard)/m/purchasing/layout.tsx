'use client';

import { BarChart3, FileText, PackageCheck, Receipt, Undo2, Users, Wallet } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { ModuleGate } from '@/lib/entitlements';

/** Purchasing route group — sub-navigation across the module's sections. */
export default function PurchasingLayout({ children }: { children: React.ReactNode }) {
  const locale = useLocale();
  const t = useTranslations('modules.purchasing');
  const links = [
    { href: 'suppliers', label: t('nav.suppliers'), icon: Users },
    { href: 'purchase-orders', label: t('nav.purchaseOrders'), icon: FileText },
    { href: 'receiving', label: t('nav.receiving'), icon: PackageCheck },
    { href: 'bills', label: t('nav.bills'), icon: Receipt },
    { href: 'payments', label: t('nav.payments'), icon: Wallet },
    { href: 'returns', label: t('nav.returns'), icon: Undo2 },
    { href: 'vendor-balances', label: t('nav.vendorBalances'), icon: BarChart3 },
  ];
  return (
    <ModuleGate moduleKey="purchasing">
      <div className="space-y-5">
        <nav aria-label={t('name')} className="flex gap-2 overflow-x-auto pb-1">
          {links.map(({ href, label, icon: Icon }) => (
            <Button key={href} asChild variant="outline" size="sm">
              <Link href={`/${locale}/m/purchasing/${href}`}>
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
