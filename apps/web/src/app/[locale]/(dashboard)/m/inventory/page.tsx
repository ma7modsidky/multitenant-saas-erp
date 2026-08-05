'use client';

import { useTranslations } from 'next-intl';

import { ModuleGate } from '@/lib/entitlements';

export default function InventoryPage() {
  const t = useTranslations();

  return (
    <ModuleGate moduleKey="inventory">
      <div className="space-y-6 animate-fade-in">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('modules.inventory.name')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('modules.inventory.description')}</p>
        </div>
        <p className="text-sm text-muted-foreground">Scaffolded by the module generator.</p>
      </div>
    </ModuleGate>
  );
}
