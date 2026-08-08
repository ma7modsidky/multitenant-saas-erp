'use client';

import { Lock } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectItem } from '@/components/ui/select';
import { INVENTORY_PAGE_SIZE } from '@/lib/api/resources';
import { ModuleGate } from '@/lib/entitlements';

import { useInventoryReservations } from './hooks';
import { localizedLabel } from './labels';
import { InventoryPagination, useInventoryListUrlState } from './table-shared';

/** Reservation state → localized badge variant + label key. */
const STATE_VARIANT: Record<string, 'default' | 'secondary' | 'outline'> = {
  held: 'default',
  committed: 'secondary',
  released: 'outline',
  expired: 'outline',
};

/** True when a reservation state value matches the API's allowed states. */
const isReservationState = (value: string): value is 'held' | 'committed' | 'released' | 'expired' =>
  value === 'held' || value === 'committed' || value === 'released' || value === 'expired';

/**
 * Reservations — held stock committed to a downstream reference (sale, order,
 * INV-7/INV-8). Read-only here; commits/releases happen in the originating
 * module (e.g. POS) through the reservation service.
 */
export function ReservationsView() {
  const t = useTranslations('modules.inventory');
  const global = useTranslations();
  const locale = useLocale();
  const searchParams = useSearchParams();
  const basePath = `/${locale}/m/inventory/stock/reservations`;
  // Search is deliberately omitted — the reservations endpoint has no `search`
  // filter; the status select below is the only narrowing (plus pagination).
  const { page, update } = useInventoryListUrlState({ basePath });
  const status = searchParams.get('status') ?? '';
  const { data, isPending } = useInventoryReservations({
    page,
    pageSize: INVENTORY_PAGE_SIZE,
    ...(isReservationState(status) ? { status } : {}),
  });

  return (
    <ModuleGate moduleKey="inventory">
      <div className="space-y-6 animate-fade-in">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('reservations.title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('reservations.subtitle')}</p>
        </div>

        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Lock className="size-3.5" aria-hidden="true" />
          {t('reservations.managedElsewhereHint')}
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={status}
            onValueChange={(value) => update({ status: value })}
            aria-label={t('reservations.filterStatus')}
            className="w-44"
          >
            <SelectItem value="">{t('reservations.allStatuses')}</SelectItem>
            {Object.keys(STATE_VARIANT).map((state) => (
              <SelectItem key={state} value={state}>
                {t(`reservations.states.${state}`)}
              </SelectItem>
            ))}
          </Select>
        </div>

        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-start text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-3 text-start font-medium">{t('reservations.tableProduct')}</th>
                    <th className="px-4 py-3 text-start font-medium">{t('reservations.tableWarehouse')}</th>
                    <th className="px-4 py-3 text-end font-medium">{t('reservations.tableQuantity')}</th>
                    <th className="px-4 py-3 text-start font-medium">{t('reservations.tableState')}</th>
                    <th className="px-4 py-3 text-start font-medium">{t('reservations.tableExpires')}</th>
                    <th className="px-4 py-3 text-start font-medium">{t('reservations.tableReference')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {isPending && !data ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                        {global('common.loading')}
                      </td>
                    </tr>
                  ) : (data?.items.length ?? 0) === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                        {t('reservations.empty')}
                      </td>
                    </tr>
                  ) : (
                    data?.items.map((reservation) => (
                      <tr key={reservation.id} className="transition-colors hover:bg-accent/30">
                        <td className="px-4 py-3 font-medium" dir="auto">
                          {localizedLabel(reservation.nameI18n, locale, reservation.sku)}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{reservation.warehouseName}</td>
                        <td className="px-4 py-3 text-end font-mono text-xs tabular-nums">{reservation.quantity}</td>
                        <td className="px-4 py-3">
                          <Badge variant={STATE_VARIANT[reservation.state] ?? 'secondary'}>
                            {t(`reservations.states.${reservation.state}`)}
                          </Badge>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-xs tabular-nums text-muted-foreground">
                          {new Date(reservation.expiresAt).toLocaleString(locale, {
                            dateStyle: 'medium',
                            timeStyle: 'short',
                          })}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          <span className="font-mono">{reservation.referenceType}</span>
                          <span className="ms-1 text-muted-foreground/70">· {reservation.referenceId.slice(0, 8)}</span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <InventoryPagination
          page={page}
          pageSize={data?.pageSize ?? INVENTORY_PAGE_SIZE}
          total={data?.total ?? 0}
          loading={isPending}
          onChange={(nextPage) => update({ page: String(nextPage) })}
        />
      </div>
    </ModuleGate>
  );
}
