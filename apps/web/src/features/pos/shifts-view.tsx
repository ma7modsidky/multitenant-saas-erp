'use client';

import { ChevronRight, FileText } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectItem } from '@/components/ui/select';
import { ModuleGate } from '@/lib/entitlements';
import { useMemberName } from '@/lib/hooks/use-member-name';
import { Can } from '@/lib/permissions';

import { usePosRegisters, usePosShifts } from './hooks';

export function ShiftsView() {
  const t = useTranslations('modules.pos');
  const locale = useLocale();

  const searchParams = useSearchParams();
  const status = searchParams.get('status') ?? '';
  const { data: shifts, isPending } = usePosShifts();
  const { data: registers } = usePosRegisters();
  const memberName = useMemberName();
  const [statusFilter, setStatusFilter] = useState(status);

  const registerById = new Map((registers?.items ?? []).map((r) => [r.id, r]));
  const filtered = statusFilter
    ? (shifts?.items ?? []).filter((shift) => shift.status === statusFilter)
    : (shifts?.items ?? []);

  return (
    <ModuleGate moduleKey="pos">
      <div className="space-y-6 animate-fade-in">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('shifts.title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('shifts.subtitle')}</p>
        </div>

        <Select
          value={statusFilter}
          onValueChange={setStatusFilter}
          className="w-48"
          aria-label={t('shifts.filterStatus')}
        >
          <SelectItem value="">{t('shifts.allStatuses')}</SelectItem>
          <SelectItem value="open">{t('shifts.statusOpen')}</SelectItem>
          <SelectItem value="closed">{t('shifts.statusClosed')}</SelectItem>
        </Select>

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
