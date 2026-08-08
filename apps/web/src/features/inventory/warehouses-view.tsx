'use client';

import { Building2 } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ApiError } from '@/lib/api';
import { ModuleGate } from '@/lib/entitlements';
import { Can } from '@/lib/permissions';

import { inventoryErrorKey } from './errors';
import { WarehouseForm } from './forms';
import { useInventoryMutations, useInventoryWarehouses } from './hooks';
import type { WarehouseFormValues } from './schemas';

/** Warehouses — list with create flow and per-warehouse detail pages. */
export function WarehousesView() {
  const t = useTranslations('modules.inventory');
  const global = useTranslations();
  const locale = useLocale();
  const { data, isPending } = useInventoryWarehouses();
  const { createWarehouse } = useInventoryMutations();

  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const canSetDefault = (data?.items.length ?? 0) === 0;

  const handleCreate = async (values: WarehouseFormValues) => {
    setError(null);
    setSuccess(null);
    try {
      await createWarehouse.mutateAsync({
        name: values.name,
        code: values.code,
        ...(values.isDefault ? { isDefault: true } : {}),
      });
      setSuccess(t('warehouses.createdMessage'));
      setShowForm(false);
    } catch (err) {
      setError(err instanceof ApiError ? inventoryErrorKey(err.code) : t('errors.unknown'));
    }
  };

  return (
    <ModuleGate moduleKey="inventory">
      <div className="space-y-6 animate-fade-in">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{t('warehouses.title')}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t('warehouses.subtitle')}</p>
          </div>
          <Can permission="inventory:warehouse:write">
            <Button onClick={() => setShowForm((current) => !current)}>
              <Building2 className="size-4" aria-hidden="true" />
              <span className="ms-1">{t('warehouses.create')}</span>
            </Button>
          </Can>
        </div>

        {error && (
          <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {t(error)}
          </p>
        )}
        {success && (
          <p
            role="status"
            className="rounded-md bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400"
          >
            {success}
          </p>
        )}

        {showForm && (
          <WarehouseForm onSubmit={handleCreate} pending={createWarehouse.isPending} canSetDefault={canSetDefault} />
        )}

        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-start text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-3 text-start font-medium">{t('warehouses.tableName')}</th>
                    <th className="px-4 py-3 text-start font-medium">{t('warehouses.tableCode')}</th>
                    <th className="px-4 py-3 text-start font-medium">{t('warehouses.tableDefault')}</th>
                    <th className="px-4 py-3 text-start font-medium">{t('warehouses.tableStatus')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {isPending && !data ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                        {global('common.loading')}
                      </td>
                    </tr>
                  ) : (data?.items.length ?? 0) === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                        {t('warehouses.empty')}
                      </td>
                    </tr>
                  ) : (
                    data?.items.map((warehouse) => (
                      <tr key={warehouse.id} className="transition-colors hover:bg-accent/30">
                        <td className="px-4 py-3 font-medium">
                          <Link
                            href={`/${locale}/m/inventory/warehouses/${warehouse.id}`}
                            className="text-primary underline-offset-4 hover:underline"
                          >
                            {warehouse.name}
                          </Link>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs">{warehouse.code}</td>
                        <td className="px-4 py-3">
                          {warehouse.isDefault && <Badge variant="secondary">{t('warehouses.default')}</Badge>}
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={warehouse.isActive ? 'default' : 'secondary'}>
                            {warehouse.isActive ? t('warehouses.active') : t('warehouses.inactive')}
                          </Badge>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </ModuleGate>
  );
}
