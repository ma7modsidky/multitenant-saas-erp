'use client';

import { ChevronRight, FileText, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectItem } from '@/components/ui/select';
import { ModuleGate } from '@/lib/entitlements';
import { useMemberName } from '@/lib/hooks/use-member-name';
import { Can } from '@/lib/permissions';

import { useCurrencies, useOrgBaseCurrency, usePosRegisters, usePosShifts } from './hooks';
import { formatMinorAmount, sumMinorAmounts } from './money';

export function ShiftsView() {
  const t = useTranslations('modules.pos');
  const locale = useLocale();
  const baseCurrency = useOrgBaseCurrency();
  const { data: currencies } = useCurrencies();
  const exponent = currencies?.find((c) => c.code === baseCurrency)?.exponent ?? 2;
  const formatMinor = (amountMinor: string) => formatMinorAmount(amountMinor, baseCurrency, { locale, exponent });

  const router = useRouter();
  const searchParams = useSearchParams();
  const status = searchParams.get('status') ?? '';
  const from = searchParams.get('from') ?? '';
  const to = searchParams.get('to') ?? '';
  const { data: shifts, isPending } = usePosShifts({
    ...(from ? { fromDate: from } : {}),
    ...(to ? { toDate: to } : {}),
  });
  const { data: registers } = usePosRegisters();
  const memberName = useMemberName();

  const basePath = `/${locale}/m/pos/shifts`;
  const setParam = (patch: Record<string, string>) => {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    const qs = next.toString();
    router.replace(qs ? `${basePath}?${qs}` : basePath, { scroll: false });
  };

  const registerById = new Map((registers?.items ?? []).map((r) => [r.id, r]));
  const filtered = status ? (shifts?.items ?? []).filter((shift) => shift.status === status) : (shifts?.items ?? []);
  const hasActiveFilters = Boolean(status || from || to);

  // Summary of the VISIBLE shifts (after the status filter) — exact integer
  // sums of the per-shift aggregates, so the date/status filters show totals.
  const summarySalesCount = filtered.reduce((n, shift) => n + (shift.salesCount ?? 0), 0);
  const summarySalesMinor = sumMinorAmounts(filtered.map((shift) => shift.salesAmountMinor ?? '0'));
  const summaryRefundsMinor = sumMinorAmounts(filtered.map((shift) => shift.refundsAmountMinor ?? '0'));

  return (
    <ModuleGate moduleKey="pos">
      <div className="space-y-6 animate-fade-in">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('shifts.title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('shifts.subtitle')}</p>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <Select
            value={status}
            onValueChange={(value) => setParam({ status: value })}
            className="w-48"
            aria-label={t('shifts.filterStatus')}
          >
            <SelectItem value="">{t('shifts.allStatuses')}</SelectItem>
            <SelectItem value="open">{t('shifts.statusOpen')}</SelectItem>
            <SelectItem value="closed">{t('shifts.statusClosed')}</SelectItem>
          </Select>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">{t('shifts.fromDate')}</Label>
            <Input
              type="date"
              value={from}
              onChange={(event) => setParam({ from: event.target.value })}
              className="h-9"
              aria-label={t('shifts.fromDate')}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">{t('shifts.toDate')}</Label>
            <Input
              type="date"
              value={to}
              onChange={(event) => setParam({ to: event.target.value })}
              className="h-9"
              aria-label={t('shifts.toDate')}
            />
          </div>
          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={() => setParam({ status: '', from: '', to: '' })}>
              <X aria-hidden="true" />
              <span className="ms-1">{t('list.resetFilters')}</span>
            </Button>
          )}
        </div>

        {/* Only once the list has data — avoids a misleading 0/0/$0.00 line while loading. */}
        {!isPending && (
          <p className="text-sm text-muted-foreground">
            {t('shifts.summary', {
              shifts: filtered.length,
              sales: summarySalesCount,
              total: formatMinor(summarySalesMinor),
              refunds: formatMinor(summaryRefundsMinor),
            })}
          </p>
        )}

        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-start text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-3 text-start font-medium">{t('shifts.tableRegister')}</th>
                    <th className="px-4 py-3 text-start font-medium">{t('shifts.tableOpenedBy')}</th>
                    <th className="px-4 py-3 text-start font-medium">{t('shifts.tableOpenedAt')}</th>
                    <th className="px-4 py-3 text-start font-medium">{t('shifts.tableClosedAt')}</th>
                    <th className="px-4 py-3 text-end font-medium">{t('shifts.tableStatus')}</th>
                    <th className="px-4 py-3 text-end font-medium">{t('shifts.tableActions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {isPending && !shifts ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                        {t('common.loading')}
                      </td>
                    </tr>
                  ) : filtered.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                        {t('shifts.empty')}
                      </td>
                    </tr>
                  ) : (
                    filtered.map((shift) => {
                      const register = registerById.get(shift.registerId);
                      return (
                        <tr key={shift.id} className="transition-colors hover:bg-accent/30">
                          <td className="px-4 py-3 font-medium" dir="auto">
                            {register?.name ?? shift.registerId}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {memberName(shift.openedBy) ?? shift.openedBy}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {new Date(shift.openedAt).toLocaleString(locale)}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {shift.closedAt ? new Date(shift.closedAt).toLocaleString(locale) : '—'}
                          </td>
                          <td className="px-4 py-3 text-end">
                            {shift.status === 'open' ? (
                              <Badge variant="secondary">{t('shifts.statusOpen')}</Badge>
                            ) : (
                              <Badge variant="outline">{t('shifts.statusClosed')}</Badge>
                            )}
                          </td>
                          <td className="px-4 py-3 text-end">
                            <Can permission="pos:report:view">
                              <Button asChild variant="ghost" size="sm">
                                <Link href={`/${locale}/m/pos/shifts/${shift.id}`}>
                                  <FileText className="size-4" aria-hidden="true" />
                                  <span className="ms-1">{t('shifts.viewReport')}</span>
                                  <ChevronRight className="ms-1 size-4 rtl:rotate-180" aria-hidden="true" />
                                </Link>
                              </Button>
                            </Can>
                          </td>
                        </tr>
                      );
                    })
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
