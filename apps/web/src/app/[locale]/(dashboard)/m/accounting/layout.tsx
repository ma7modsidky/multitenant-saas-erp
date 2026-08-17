'use client';

import { BarChart3, BookOpen, FileText, NotebookPen, Undo2, Wallet } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { ModuleGate } from '@/lib/entitlements';

/** Accounting route group — sub-navigation across the module's sections. */
export default function AccountingLayout({ children }: { children: React.ReactNode }) {
  const locale = useLocale();
  const t = useTranslations('modules.accounting');
  const links = [
    { href: 'coa', label: t('nav.coa'), icon: BookOpen },
    { href: 'journal', label: t('nav.journal'), icon: NotebookPen },
    { href: 'invoices', label: t('nav.invoices'), icon: FileText },
    { href: 'payments', label: t('nav.payments'), icon: Wallet },
    { href: 'credit-notes', label: t('nav.creditNotes'), icon: Undo2 },
    { href: 'reports', label: t('nav.reports'), icon: BarChart3 },
  ];
  return (
    <ModuleGate moduleKey="accounting">
      <div className="space-y-5">
        <nav aria-label={t('name')} className="flex gap-2 overflow-x-auto pb-1">
          {links.map(({ href, label, icon: Icon }) => (
            <Button key={href} asChild variant="outline" size="sm">
              <Link href={`/${locale}/m/accounting/${href}`}>
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
