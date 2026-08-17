'use client';

import { ArrowLeft, Download, FileText, Pencil, Power, PowerOff } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api';
import { ModuleGate, useEntitlements } from '@/lib/entitlements';
import { Can } from '@/lib/permissions';

import type { AccountingAccount } from '@/lib/api/resources';

import { accountingErrorKey } from './errors';
import { useAccountingAccount, useAccountingMutations, useCurrencies, useOrgBaseCurrency } from './hooks';
import { accountDisplayName, balanceSide, formatMinorAmount, naturalBalance, naturalRunningBalance } from './labels';

/** Reject the same dotted technical keys as the Add Account form (ACC-5). */
function isTechnicalKey(name: string): boolean {
  const trimmed = name.trim();
  if (/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(trimmed)) return true;
  return /^(coa|accounting|modules|errors|common)\./i.test(trimmed);
}

/** Credit-normal account types (liability/equity/revenue). */
const CREDIT_NORMAL = new Set(['liability', 'equity', 'revenue']);

/**
 * AccountDetailView — the general-ledger view for one account: header (name,
 * code, type, current total balance) plus the append-only transaction history
 * with a running balance (ACC-2/ACC-5). Custom accounts can be renamed and
 * activated/deactivated from the header; system accounts stay immutable.
 */
export function AccountDetailView({ id }: { id: string }) {
  const t = useTranslations('modules.accounting');
  const global = useTranslations();
  const locale = useLocale();
  const baseCurrency = useOrgBaseCurrency();
  const { data: currencies } = useCurrencies();
  const exponent = currencies?.find((c) => c.code === baseCurrency)?.exponent ?? 2;
  const formatMinor = (amountMinor: string) => formatMinorAmount(amountMinor, baseCurrency, { locale, exponent });

  // ─── GL history filters (date range + pagination, server-side) ──────────
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [range, setRange] = useState<{ fromDate?: string; toDate?: string }>({});
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;

  const { data, isPending, isError } = useAccountingAccount(id, {
    ...(range.fromDate ? { fromDate: range.fromDate } : {}),
    ...(range.toDate ? { toDate: range.toDate } : {}),
    page,
    pageSize: PAGE_SIZE,
  });
  const { updateAccount } = useAccountingMutations();
  const { data: billing } = useEntitlements();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Edit + toggle state (custom accounts only, ACC-5).
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [toggleTarget, setToggleTarget] = useState<AccountingAccount | null>(null);

  const advancedCoaEnabled =
    billing?.entitlements.find((e) => e.moduleKey === 'accounting')?.features?.includes('advanced_coa') ?? false;

  if (isPending && !data)
    return <p className="py-10 text-center text-sm text-muted-foreground">{t('common.loading')}</p>;
  if (isError || !data) return <p className="py-10 text-center text-sm text-destructive">{t('errors.notFound')}</p>;

  const account = data.account;
  const name = accountDisplayName(account, locale, t);
  const netMinor = data.balance.netAmountMinor;
  const side = balanceSide(netMinor, account.type);
  const currentBalance = naturalBalance(netMinor, account.type);
  const creditNormal = CREDIT_NORMAL.has(account.type);
  const totalPages = data ? Math.max(1, Math.ceil(data.movements.total / data.movements.pageSize)) : 1;

  /** CSV export of the CURRENT filtered GL page (client-side download). */
  const handleExportCsv = () => {
    const esc = (value: string | number) => {
      const raw = String(value ?? '');
      return /[",\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
    };
    const rows: string[] = [
      [
        `GL ${name} (${account.code})`,
        ...(range.fromDate ? [t('detail.fromDate'), range.fromDate] : []),
        ...(range.toDate ? [t('detail.toDate'), range.toDate] : []),
      ].join(','),
      [
        t('detail.tableDate'),
        t('detail.tableEntry'),
        t('detail.tableDescription'),
        t('detail.tableDebit'),
        t('detail.tableCredit'),
        t('detail.tableRunningBalance'),
      ].join(','),
      ...data.movements.items.map((movement) =>
        [
          esc(movement.entryDate),
          esc(`JE-${String(movement.entryNumber).padStart(4, '0')}`),
          esc(movement.description || ''),
          esc(formatMinor(movement.debitAmountMinor)),
          esc(formatMinor(movement.creditAmountMinor)),
          esc(formatMinor(naturalRunningBalance(movement.runningBalanceMinor, account.type))),
        ].join(','),
      ),
    ];
    const blob = new Blob([`\uFEFF${rows.join('\n')}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `gl-${account.code}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const handleSaveEdit = async () => {
    const trimmed = editName.trim();
    if (!trimmed || isTechnicalKey(trimmed)) return;
    setError(null);
    setSuccess(null);
    try {
      await updateAccount.mutateAsync({ accountId: account.id, name: trimmed });
      setSuccess(t('coa.editedMessage'));
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiError ? t(accountingErrorKey(err.code)) : t('errors.unknown'));
    }
  };

  const handleToggleActive = async () => {
    if (!toggleTarget) return;
    setError(null);
    setSuccess(null);
    try {
      await updateAccount.mutateAsync({ accountId: toggleTarget.id, isActive: !toggleTarget.isActive });
      setSuccess(toggleTarget.isActive ? t('coa.deactivatedMessage') : t('coa.activatedMessage'));
    } catch (err) {
      setError(err instanceof ApiError ? t(accountingErrorKey(err.code)) : t('errors.unknown'));
    } finally {
      setToggleTarget(null);
    }
  };

  return (
    <ModuleGate moduleKey="accounting">
      <div className="space-y-5 animate-fade-in">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button asChild variant="ghost" size="sm">
              <Link href={`/${locale}/m/accounting/coa`}>
                <ArrowLeft className="rtl:rotate-180" />
                {t('detail.back')}
              </Link>
            </Button>
            <h1 className="text-xl font-semibold" dir="auto">
              {name}
            </h1>
            <span className="font-mono text-xs text-muted-foreground">{account.code}</span>
            <Badge variant="outline">{t(`coa.types.${account.type}`)}</Badge>
            <Badge variant={account.isActive ? 'default' : 'secondary'}>
              {account.isActive ? t('coa.active') : t('coa.inactive')}
            </Badge>
          </div>
          {!account.isSystem && advancedCoaEnabled && (
            <Can permission="accounting:coa:manage">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (editing) {
                      setEditing(false);
                    } else {
                      setEditName(account.nameI18n.en ?? '');
                      setEditing(true);
                    }
                  }}
                >
                  <Pencil className="size-4" aria-hidden="true" />
                  <span className="ms-1">{editing ? global('common.cancel') : global('common.edit')}</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setToggleTarget(account)}
                  aria-label={account.isActive ? t('coa.deactivateAction') : t('coa.activateAction')}
                >
                  {account.isActive ? (
                    <PowerOff className="size-4" aria-hidden="true" />
                  ) : (
                    <Power className="size-4" aria-hidden="true" />
                  )}
                  <span className="ms-1">{account.isActive ? t('coa.deactivate') : t('coa.activate')}</span>
                </Button>
              </div>
            </Can>
          )}
        </div>

        {error && (
          <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
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

        {editing && (
          <Card className="border-primary/20">
            <CardContent className="space-y-3 pt-6">
              <div className="space-y-2">
                <Label htmlFor="detail-edit-name">{t('coa.fields.name')}</Label>
                <Input
                  id="detail-edit-name"
                  dir="auto"
                  value={editName}
                  onChange={(event) => setEditName(event.target.value)}
                  aria-invalid={editName.trim() === '' || isTechnicalKey(editName) ? true : undefined}
                />
                {(editName.trim() === '' || isTechnicalKey(editName)) && (
                  <p className="text-xs text-destructive">
                    {editName.trim() === '' ? t('coa.fields.nameRequired') : t('coa.fields.namePlainHint')}
                  </p>
                )}
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setEditing(false)}>
                  {t('invoices.cancel')}
                </Button>
                <Button
                  onClick={() => void handleSaveEdit()}
                  loading={updateAccount.isPending}
                  disabled={editName.trim() === '' || isTechnicalKey(editName)}
                >
                  {global('common.save')}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Current total balance — in the account's natural direction. */}
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardContent className="pt-6">
              <p className="text-xs font-medium text-muted-foreground">
                {creditNormal ? t('detail.creditBalance') : t('detail.debitBalance')}
              </p>
              <p className="mt-1 font-mono text-2xl font-semibold tabular-nums">{formatMinor(currentBalance)}</p>
              <Badge variant={side === 'debit' ? 'outline' : 'secondary'} className="mt-2">
                {t(`detail.side${side === 'debit' ? 'Debit' : 'Credit'}`)}
              </Badge>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <p className="text-xs font-medium text-muted-foreground">{t('detail.debitTotal')}</p>
              <p className="mt-1 font-mono text-xl font-semibold tabular-nums">
                {formatMinor(data.balance.debitTotal)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <p className="text-xs font-medium text-muted-foreground">{t('detail.creditTotal')}</p>
              <p className="mt-1 font-mono text-xl font-semibold tabular-nums">
                {formatMinor(data.balance.creditTotal)}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Transaction history — the append-only GL for this account (ACC-2). */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle className="text-base">{t('detail.transactionHistory')}</CardTitle>
              <Button
                variant="outline"
                size="sm"
                disabled={!data || data.movements.items.length === 0}
                onClick={() => handleExportCsv()}
              >
                <Download className="size-4" aria-hidden="true" />
                <span className="ms-1">{t('detail.exportCsv')}</span>
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {/* Date-range filter + pagination controls. */}
            <div className="flex flex-wrap items-end gap-3 border-b bg-muted/20 px-4 py-3">
              <div className="space-y-1">
                <Label htmlFor="detail-from">{t('detail.fromDate')}</Label>
                <Input
                  id="detail-from"
                  type="date"
                  className="h-8 w-40"
                  value={fromDate}
                  onChange={(event) => setFromDate(event.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="detail-to">{t('detail.toDate')}</Label>
                <Input
                  id="detail-to"
                  type="date"
                  className="h-8 w-40"
                  value={toDate}
                  onChange={(event) => setToDate(event.target.value)}
                />
              </div>
              <Button
                size="sm"
                disabled={fromDate === '' && toDate === ''}
                onClick={() => {
                  setPage(1);
                  setRange({ ...(fromDate ? { fromDate } : {}), ...(toDate ? { toDate } : {}) });
                }}
              >
                {t('detail.applyFilter')}
              </Button>
              {(range.fromDate !== undefined || range.toDate !== undefined) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setFromDate('');
                    setToDate('');
                    setRange({});
                    setPage(1);
                  }}
                >
                  {t('detail.clearFilter')}
                </Button>
              )}
              <div className="ms-auto flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  {t('detail.previous')}
                </Button>
                <span className="text-xs text-muted-foreground">
                  {t('detail.pageOf', {
                    page: String(data?.movements.page ?? 1),
                    total: String(totalPages),
                  })}
                </span>
                <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                  {t('detail.next')}
                </Button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-start text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-3 text-start font-medium">{t('detail.tableDate')}</th>
                    <th className="px-4 py-3 text-start font-medium">{t('detail.tableEntry')}</th>
                    <th className="px-4 py-3 text-start font-medium">{t('detail.tableDescription')}</th>
                    <th className="px-4 py-3 text-end font-medium">{t('detail.tableDebit')}</th>
                    <th className="px-4 py-3 text-end font-medium">{t('detail.tableCredit')}</th>
                    <th className="px-4 py-3 text-end font-medium">{t('detail.tableRunningBalance')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {isPending && !data ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                        {t('common.loading')}
                      </td>
                    </tr>
                  ) : data.movements.items.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                        {t('detail.noMovements')}
                      </td>
                    </tr>
                  ) : (
                    data.movements.items.map((movement) => {
                      const running = naturalRunningBalance(movement.runningBalanceMinor, account.type);
                      return (
                        <tr key={movement.id} className="transition-colors hover:bg-accent/30">
                          <td className="whitespace-nowrap px-4 py-3 text-xs tabular-nums text-muted-foreground">
                            {movement.entryDate}
                          </td>
                          <td className="px-4 py-3 font-mono text-xs">
                            <Link
                              href={`/${locale}/m/accounting/journal`}
                              className="text-primary underline-offset-4 hover:underline"
                            >
                              JE-{String(movement.entryNumber).padStart(4, '0')}
                            </Link>
                          </td>
                          <td className="max-w-[20rem] px-4 py-3 text-muted-foreground" dir="auto">
                            <span className="block truncate">{movement.description || '—'}</span>
                            <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                              {movement.sourceType === 'invoice_issuance' && movement.sourceId && (
                                <Link
                                  href={`/${locale}/m/accounting/invoices/${movement.sourceId}`}
                                  className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
                                >
                                  <FileText className="size-3" aria-hidden="true" />
                                  {t('journal.viewInvoice')}
                                </Link>
                              )}
                              {movement.status === 'reversed' && (
                                <Badge variant="secondary" className="ms-0">
                                  {t('journal.statusReversed')}
                                </Badge>
                              )}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-end font-mono text-xs tabular-nums">
                            {movement.debitAmountMinor !== '0' ? formatMinor(movement.debitAmountMinor) : '—'}
                          </td>
                          <td className="px-4 py-3 text-end font-mono text-xs tabular-nums">
                            {movement.creditAmountMinor !== '0' ? formatMinor(movement.creditAmountMinor) : '—'}
                          </td>
                          <td className="px-4 py-3 text-end font-mono text-xs tabular-nums">
                            {running.startsWith('-') ? `(${formatMinor(running.slice(1))})` : formatMinor(running)}
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

        <ConfirmDialog
          open={toggleTarget !== null}
          title={toggleTarget?.isActive ? t('coa.deactivateTitle') : t('coa.activateTitle')}
          description={
            toggleTarget
              ? toggleTarget.isActive
                ? t('coa.deactivateBody', { code: toggleTarget.code, name: name })
                : t('coa.activateBody', { code: toggleTarget.code, name: name })
              : undefined
          }
          confirmLabel={toggleTarget?.isActive ? t('coa.deactivate') : t('coa.activate')}
          cancelLabel={global('common.cancel')}
          closeLabel={global('common.close')}
          loading={updateAccount.isPending}
          onConfirm={() => void handleToggleActive()}
          onCancel={() => setToggleTarget(null)}
        />
      </div>
    </ModuleGate>
  );
}
