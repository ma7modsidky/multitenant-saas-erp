'use client';

import type { LucideIcon } from 'lucide-react';

/**
 * PurchasingPageHeader — the CRM-style page header: icon badge + title +
 * subtitle on the start side, action buttons on the end side. Mirrors
 * `InventoryPageHeader` / `AccountingPageHeader` so every module list page
 * reads consistently.
 */
export function PurchasingPageHeader({
  icon: Icon,
  title,
  subtitle,
  actions,
}: {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 rounded-xl border bg-card p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <span className="rounded-lg bg-primary p-2 text-primary-foreground">
          <Icon className="size-5" aria-hidden="true" />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}
