'use client';

import { BarChart3, Download, Printer } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ModuleGate } from '@/lib/entitlements';

import type {
  AccountingArAging,
  AccountingAgingBucket,
  AccountingBalanceSheet,
  AccountingIncomeStatement,
  AccountingReportPeriod,
  AccountingTrialBalance,
} from '@/lib/api/resources';

import {
  useAccountingArAging,
  useAccountingBalanceSheet,
  useAccountingIncomeStatement,
  useAccountingTrialBalance,
  useCurrencies,
  useOrgBaseCurrency,
} from './hooks';
import { accountDisplayName, balanceSide, formatMinorAmount, naturalBalance } from './labels';
import { AccountingPageHeader } from './page-header';

type ReportKey = 'trialBalance' | 'incomeStatement' | 'balanceSheet' | 'arAging';

/** The aging bucket keys (ACC-8/ACC-9) — ordered for the table. */
const AGING_BUCKETS: readonly AccountingAgingBucket['key'][] = ['current', '1_30', '31_60', '61_90', '90_plus'];

/** Shortcuts for the period filter (dates are YYYY-MM-DD). */
function periodShortcuts(now = new Date()): Array<{ key: string; label: string; period: AccountingReportPeriod }> {
  const iso = (date: Date) => date.toISOString().slice(0, 10);
  const firstOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const lastOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  const prevMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const prevMonthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  return [
    { key: 'all', label: 'reports.allTime', period: {} },
    { key: 'thisMonth', label: 'reports.thisMonth', period: { fromDate: iso(firstOfMonth), toDate: iso(lastOfMonth) } },
    {
      key: 'lastMonth',
      label: 'reports.lastMonth',
      period: { fromDate: iso(prevMonth), toDate: iso(prevMonthEnd) },
    },
  ];
}

/**
 * ReportsView — the accounting reports hub. Four read-only financial
 * statements computed server-side from the GL (ACC-1) and the AR subledger
 * (ACC-8/ACC-9):
 *   - Trial balance    — every account's debit/credit totals + the Σ check.
 *   - Income statement — revenue vs expenses → net income for a period.
 *   - Balance sheet    — assets / liabilities / equity as of a date.
 *   - AR aging         — open invoices bucketed by days past due.
 * The report bodies are presentational components fed by this view's queries,
 * so the period / as-of filters always reach the server.
 */
export function ReportsView() {
  const t = useTranslations('modules.accounting');
  const locale = useLocale();
  const baseCurrency = useOrgBaseCurrency();
  const { data: currencies } = useCurrencies();
  const exponent = currencies?.find((c) => c.code === baseCurrency)?.exponent ?? 2;
  const formatMinor = (amountMinor: string, currency = baseCurrency) =>
    formatMinorAmount(amountMinor, currency, { locale, exponent });

  const [active, setActive] = useState<ReportKey>('trialBalance');
  // Shared period filter (trial balance / income statement).
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [period, setPeriod] = useState<AccountingReportPeriod>({});
  // Shared as-of date (balance sheet / AR aging); '' = today on the server.
  const [asOfDate, setAsOfDate] = useState('');
  const [asOf, setAsOf] = useState<string | undefined>(undefined);

  const shortcuts = useMemo(() => periodShortcuts(), []);
  const isPeriodReport = active === 'trialBalance' || active === 'incomeStatement';
  const isAsOfReport = active === 'balanceSheet' || active === 'arAging';

  const trialBalance = useAccountingTrialBalance(isPeriodReport ? period : {});
  const incomeStatement = useAccountingIncomeStatement(isPeriodReport ? period : {});
  const balanceSheet = useAccountingBalanceSheet(isAsOfReport ? asOf : undefined);
  const arAging = useAccountingArAging(isAsOfReport ? asOf : undefined);

  const applyPeriod = () => setPeriod({ ...(fromDate ? { fromDate } : {}), ...(toDate ? { toDate } : {}) });
  const applyAsOf = () => setAsOf(asOfDate || undefined);

  const handlePrint = () => window.print();

  const downloadCsv = (filename: string, header: string[], rows: string[][], trailing: string[] = []) => {
    const esc = (value: string) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
    const lines = [
      header.map(esc).join(','),
      ...rows.map((row) => row.map(esc).join(',')),
      ...(trailing.length ? ['', ...trailing] : []),
    ];
    const blob = new Blob([`\uFEFF${lines.join('\n')}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const reports: Array<{ key: ReportKey; labelKey: string; descKey: string }> = [
    { key: 'trialBalance', labelKey: 'reports.trialBalance', descKey: 'reports.trialBalanceDesc' },
    { key: 'incomeStatement', labelKey: 'reports.incomeStatement', descKey: 'reports.incomeStatementDesc' },
    { key: 'balanceSheet', labelKey: 'reports.balanceSheet', descKey: 'reports.balanceSheetDesc' },
    { key: 'arAging', labelKey: 'reports.arAging', descKey: 'reports.arAgingDesc' },
  ];
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- reports is a non-empty literal list
  const activeReport = reports.find((report) => report.key === active) ?? reports[0]!;

  return (
    <ModuleGate moduleKey="accounting">
      <div className="space-y-6 animate-fade-in">
        <AccountingPageHeader icon={BarChart3} title={t('reports.title')} subtitle={t('reports.subtitle')} />

        {/* Report picker + filters. */}
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2 print:hidden" role="tablist" aria-label={t('reports.title')}>
            {reports.map((report) => (
              <Button
                key={report.key}
                variant={active === report.key ? 'default' : 'outline'}
                size="sm"
                role="tab"
                aria-selected={active === report.key}
                onClick={() => setActive(report.key)}
              >
                {t(report.labelKey)}
              </Button>
            ))}
          </div>

          {isPeriodReport && (
            <div className="flex flex-wrap items-end gap-3 rounded-md border bg-card p-3 print:hidden">
              <div className="space-y-1">
                <Label htmlFor="report-from">{t('reports.fromDate')}</Label>
                <Input
                  id="report-from"
                  type="date"
                  value={fromDate}
                  onChange={(event) => setFromDate(event.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="report-to">{t('reports.toDate')}</Label>
                <Input id="report-to" type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} />
              </div>
              <Button size="sm" onClick={applyPeriod} disabled={fromDate === '' && toDate === ''}>
                {t('reports.apply')}
              </Button>
              {shortcuts.map((shortcut) => (
                <Button
                  key={shortcut.key}
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setPeriod(shortcut.period);
                    setFromDate(shortcut.period.fromDate ?? '');
                    setToDate(shortcut.period.toDate ?? '');
                  }}
                >
                  {t(shortcut.label)}
                </Button>
              ))}
            </div>
          )}

          {isAsOfReport && (
            <div className="flex flex-wrap items-end gap-3 rounded-md border bg-card p-3 print:hidden">
              <div className="space-y-1">
                <Label htmlFor="report-asof">{t('reports.asOf')}</Label>
                <Input
                  id="report-asof"
                  type="date"
                  value={asOfDate}
                  onChange={(event) => setAsOfDate(event.target.value)}
                />
              </div>
              <Button size="sm" onClick={applyAsOf} disabled={asOfDate === ''}>
                {t('reports.apply')}
              </Button>
              <span className="text-xs text-muted-foreground">{t('reports.asOfHint')}</span>
            </div>
          )}

          {/* Action bar — print + CSV export (hidden when printing). */}
          <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
            <p className="text-xs text-muted-foreground">{t(activeReport.descKey)}</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handlePrint}>
                <Printer className="size-4" aria-hidden="true" />
                <span className="ms-1">{t('reports.print')}</span>
              </Button>
              {active === 'trialBalance' && trialBalance.data && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    downloadCsv(
                      'trial-balance.csv',
                      [
                        t('reports.account'),
                        t('reports.code'),
                        t('reports.debit'),
                        t('reports.credit'),
                        t('reports.net'),
                        t('reports.side'),
                      ],
                      trialBalance.data.rows.map((row) => [
                        accountDisplayName(row, locale, t),
                        row.code,
                        formatMinor(row.debitTotalMinor),
                        formatMinor(row.creditTotalMinor),
                        formatMinor(naturalBalance(row.netMinor, row.type)),
                        t(`detail.side${balanceSide(row.netMinor, row.type) === 'debit' ? 'Debit' : 'Credit'}`),
                      ]),
                      [
                        [
                          t('reports.total'),
                          '',
                          formatMinor(trialBalance.data.totals.debitTotalMinor),
                          formatMinor(trialBalance.data.totals.creditTotalMinor),
                          '',
                          trialBalance.data.balanced ? t('reports.balanced') : t('reports.unbalanced'),
                        ].join(','),
                      ],
                    )
                  }
                >
                  <Download className="size-4" aria-hidden="true" />
                  <span className="ms-1">{t('reports.exportCsv')}</span>
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Report bodies — presentational, fed by the queries above. */}
        {active === 'trialBalance' && (
          <TrialBalanceReport
            data={trialBalance.data}
            isPending={trialBalance.isPending}
            isError={trialBalance.isError}
          />
        )}
        {active === 'incomeStatement' && (
          <IncomeStatementReport
            data={incomeStatement.data}
            isPending={incomeStatement.isPending}
            isError={incomeStatement.isError}
          />
        )}
        {active === 'balanceSheet' && (
          <BalanceSheetReport
            data={balanceSheet.data}
            isPending={balanceSheet.isPending}
            isError={balanceSheet.isError}
          />
        )}
        {active === 'arAging' && (
          <ArAgingReport data={arAging.data} isPending={arAging.isPending} isError={arAging.isError} />
        )}
      </div>
    </ModuleGate>
  );
}

// ─── Presentational report bodies ───────────────────────────────────────────

function useMoney() {
  const locale = useLocale();
  const baseCurrency = useOrgBaseCurrency();
  const { data: currencies } = useCurrencies();
  const exponent = currencies?.find((c) => c.code === baseCurrency)?.exponent ?? 2;
  return (amountMinor: string, currency = baseCurrency) =>
    formatMinorAmount(amountMinor, currency, { locale, exponent });
}

/** Account cell — mono code + localized name. */
function AccountCell({ code, name }: { code: string; name: string }) {
  return (
    <span className="flex items-baseline gap-2">
      <span className="font-mono text-xs text-muted-foreground">{code}</span>
      <span dir="auto">{name}</span>
    </span>
  );
}

function LoadingRow({ colSpan }: { colSpan: number }) {
  const t = useTranslations('modules.accounting');
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-8 text-center text-muted-foreground">
        {t('common.loading')}
      </td>
    </tr>
  );
}

function ErrorRow({ colSpan }: { colSpan: number }) {
  const t = useTranslations('modules.accounting');
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-8 text-center text-destructive">
        {t('errors.notFound')}
      </td>
    </tr>
  );
}

function EmptyRow({ colSpan, messageKey }: { colSpan: number; messageKey: string }) {
  const t = useTranslations('modules.accounting');
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-8 text-center text-muted-foreground">
        {t(messageKey)}
      </td>
    </tr>
  );
}

function TrialBalanceReport({
  data,
  isPending,
  isError,
}: {
  data: AccountingTrialBalance | undefined;
  isPending: boolean;
  isError: boolean;
}) {
  const t = useTranslations('modules.accounting');
  const locale = useLocale();
  const formatMinor = useMoney();

  return (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-start text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 text-start font-medium">{t('reports.account')}</th>
                <th className="px-4 py-3 text-end font-medium">{t('reports.debit')}</th>
                <th className="px-4 py-3 text-end font-medium">{t('reports.credit')}</th>
                <th className="px-4 py-3 text-end font-medium">{t('reports.net')}</th>
                <th className="px-4 py-3 text-end font-medium">{t('reports.side')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isPending && !data ? (
                <LoadingRow colSpan={5} />
              ) : isError || !data ? (
                <ErrorRow colSpan={5} />
              ) : data.rows.length === 0 ? (
                <EmptyRow colSpan={5} messageKey="reports.emptyTrialBalance" />
              ) : (
                data.rows.map((row) => {
                  const net = naturalBalance(row.netMinor, row.type);
                  const side = balanceSide(row.netMinor, row.type);
                  return (
                    <tr key={row.accountId} className="transition-colors hover:bg-accent/30">
                      <td className="px-4 py-2.5">
                        <AccountCell code={row.code} name={accountDisplayName(row, locale, t)} />
                      </td>
                      <td className="px-4 py-2.5 text-end font-mono text-xs tabular-nums">
                        {row.debitTotalMinor !== '0' ? formatMinor(row.debitTotalMinor) : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-end font-mono text-xs tabular-nums">
                        {row.creditTotalMinor !== '0' ? formatMinor(row.creditTotalMinor) : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-end font-mono text-xs tabular-nums">
                        {net !== '0' ? formatMinor(net) : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-end">
                        {net !== '0' ? (
                          <Badge variant="outline">{t(`detail.side${side === 'debit' ? 'Debit' : 'Credit'}`)}</Badge>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            {data && !isPending && (
              <tfoot>
                <tr className="border-t text-xs">
                  <td className="px-4 py-3 font-medium text-muted-foreground">{t('reports.total')}</td>
                  <td className="px-4 py-3 text-end font-mono tabular-nums">
                    {formatMinor(data.totals.debitTotalMinor)}
                  </td>
                  <td className="px-4 py-3 text-end font-mono tabular-nums">
                    {formatMinor(data.totals.creditTotalMinor)}
                  </td>
                  <td colSpan={2} className="px-4 py-3 text-end">
                    <Badge variant={data.balanced ? 'default' : 'destructive'}>
                      {data.balanced ? t('reports.balanced') : t('reports.unbalanced')}
                    </Badge>
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function IncomeStatementReport({
  data,
  isPending,
  isError,
}: {
  data: AccountingIncomeStatement | undefined;
  isPending: boolean;
  isError: boolean;
}) {
  const t = useTranslations('modules.accounting');
  const locale = useLocale();
  const formatMinor = useMoney();

  return (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-start text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 text-start font-medium">{t('reports.account')}</th>
                <th className="px-4 py-3 text-end font-medium">{t('reports.amount')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isPending && !data ? (
                <LoadingRow colSpan={2} />
              ) : isError || !data ? (
                <ErrorRow colSpan={2} />
              ) : data.revenue.length === 0 && data.expenses.length === 0 ? (
                <EmptyRow colSpan={2} messageKey="reports.emptyIncomeStatement" />
              ) : (
                <>
                  {data.revenue.length > 0 && (
                    <>
                      <tr>
                        <td
                          colSpan={2}
                          className="px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground"
                        >
                          {t('reports.revenue')}
                        </td>
                      </tr>
                      {data.revenue.map((line) => (
                        <tr key={line.accountId} className="transition-colors hover:bg-accent/30">
                          <td className="px-4 py-2.5">
                            <AccountCell code={line.code} name={accountDisplayName(line, locale, t)} />
                          </td>
                          <td className="px-4 py-2.5 text-end font-mono text-xs tabular-nums">
                            {formatMinor(line.netMinor)}
                          </td>
                        </tr>
                      ))}
                    </>
                  )}
                  {data.expenses.length > 0 && (
                    <>
                      <tr>
                        <td
                          colSpan={2}
                          className="px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground"
                        >
                          {t('reports.expenses')}
                        </td>
                      </tr>
                      {data.expenses.map((line) => (
                        <tr key={line.accountId} className="transition-colors hover:bg-accent/30">
                          <td className="px-4 py-2.5">
                            <AccountCell code={line.code} name={accountDisplayName(line, locale, t)} />
                          </td>
                          <td className="px-4 py-2.5 text-end font-mono text-xs tabular-nums">
                            {formatMinor(line.netMinor)}
                          </td>
                        </tr>
                      ))}
                    </>
                  )}
                </>
              )}
            </tbody>
            {data && !isPending && (
              <tfoot>
                <tr className="border-t text-xs">
                  <td className="px-4 py-3 font-medium text-muted-foreground">{t('reports.revenueTotal')}</td>
                  <td className="px-4 py-3 text-end font-mono tabular-nums">{formatMinor(data.revenueTotalMinor)}</td>
                </tr>
                <tr className="text-xs">
                  <td className="px-4 py-1 font-medium text-muted-foreground">{t('reports.expenseTotal')}</td>
                  <td className="px-4 py-1 text-end font-mono tabular-nums">{formatMinor(data.expenseTotalMinor)}</td>
                </tr>
                <tr className="border-t text-sm">
                  <td className="px-4 py-3 font-semibold">{t('reports.netIncome')}</td>
                  <td
                    className={`px-4 py-3 text-end font-mono font-semibold tabular-nums ${
                      BigInt(data.netIncomeMinor) < 0n ? 'text-destructive' : 'text-emerald-700 dark:text-emerald-400'
                    }`}
                  >
                    {formatMinor(data.netIncomeMinor)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function BalanceSheetReport({
  data,
  isPending,
  isError,
}: {
  data: AccountingBalanceSheet | undefined;
  isPending: boolean;
  isError: boolean;
}) {
  const t = useTranslations('modules.accounting');
  const locale = useLocale();
  const formatMinor = useMoney();

  const sections = data
    ? [
        { titleKey: 'reports.assets', lines: data.assets, totalMinor: data.assetTotalMinor },
        { titleKey: 'reports.liabilities', lines: data.liabilities, totalMinor: data.liabilityTotalMinor },
        { titleKey: 'reports.equity', lines: data.equity, totalMinor: data.equityTotalMinor },
      ]
    : [];

  return (
    <Card>
      <CardContent className="p-0">
        {isPending && !data ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">{t('common.loading')}</p>
        ) : isError || !data ? (
          <p className="px-4 py-8 text-center text-sm text-destructive">{t('errors.notFound')}</p>
        ) : data.assets.length + data.liabilities.length + data.equity.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">{t('reports.emptyBalanceSheet')}</p>
        ) : (
          <div className="space-y-6 p-4">
            {sections.map((section) => (
              <div key={section.titleKey}>
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t(section.titleKey)}
                </p>
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full text-sm">
                    <tbody className="divide-y divide-border">
                      {section.lines.length === 0 ? (
                        <tr>
                          <td className="px-4 py-2.5 text-muted-foreground">—</td>
                        </tr>
                      ) : (
                        section.lines.map((line) => (
                          <tr key={line.accountId} className="transition-colors hover:bg-accent/30">
                            <td className="px-4 py-2.5">
                              <AccountCell code={line.code} name={accountDisplayName(line, locale, t)} />
                            </td>
                            <td className="px-4 py-2.5 text-end font-mono text-xs tabular-nums">
                              {formatMinor(line.balanceMinor)}
                            </td>
                          </tr>
                        ))
                      )}
                      <tr className="border-t bg-accent/20">
                        <td className="px-4 py-2.5 text-sm font-semibold">{t('reports.sectionTotal')}</td>
                        <td className="px-4 py-2.5 text-end font-mono text-sm font-semibold tabular-nums">
                          {formatMinor(section.totalMinor)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
            <p className="text-xs text-muted-foreground">{t('reports.balanceSheetHint')}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ArAgingReport({
  data,
  isPending,
  isError,
}: {
  data: AccountingArAging | undefined;
  isPending: boolean;
  isError: boolean;
}) {
  const t = useTranslations('modules.accounting');
  const formatMinor = useMoney();

  return (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-start text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 text-start font-medium">{t('reports.bucket')}</th>
                <th className="px-4 py-3 text-start font-medium">{t('reports.customer')}</th>
                <th className="px-4 py-3 text-start font-medium">{t('reports.invoice')}</th>
                <th className="px-4 py-3 text-start font-medium">{t('reports.dueDate')}</th>
                <th className="px-4 py-3 text-end font-medium">{t('reports.daysPastDue')}</th>
                <th className="px-4 py-3 text-end font-medium">{t('reports.balanceDue')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isPending && !data ? (
                <LoadingRow colSpan={6} />
              ) : isError || !data ? (
                <ErrorRow colSpan={6} />
              ) : data.totalOutstandingMinor === '0' && data.buckets.every((bucket) => bucket.invoices.length === 0) ? (
                <EmptyRow colSpan={6} messageKey="reports.emptyArAging" />
              ) : (
                AGING_BUCKETS.flatMap((key) => {
                  const bucket = data.buckets.find((candidate) => candidate.key === key);
                  if (!bucket || bucket.invoices.length === 0) return [];
                  return [
                    <tr key={key} className="bg-accent/20">
                      <td
                        colSpan={5}
                        className="px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground"
                      >
                        {t(`reports.bucketLabel.${key}`)}
                      </td>
                      <td className="px-4 py-2 text-end font-mono text-xs font-semibold tabular-nums">
                        {formatMinor(bucket.totalMinor)}
                      </td>
                    </tr>,
                    ...bucket.invoices.map((invoice) => (
                      <tr key={invoice.invoiceId} className="transition-colors hover:bg-accent/30">
                        <td />
                        <td className="px-4 py-2.5" dir="auto">
                          {invoice.customerName}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-xs">{invoice.invoiceNumber}</td>
                        <td className="px-4 py-2.5 text-xs tabular-nums text-muted-foreground">{invoice.dueDate}</td>
                        <td className="px-4 py-2.5 text-end text-xs tabular-nums">{invoice.daysPastDue}</td>
                        <td className="px-4 py-2.5 text-end font-mono text-xs tabular-nums">
                          {formatMinor(invoice.balanceDueMinor, invoice.currency)}
                        </td>
                      </tr>
                    )),
                  ];
                })
              )}
            </tbody>
            {data && !isPending && data.totalOutstandingMinor !== '0' && (
              <tfoot>
                <tr className="border-t">
                  <td colSpan={5} className="px-4 py-3 text-sm font-semibold">
                    {t('reports.totalOutstanding')}
                  </td>
                  <td className="px-4 py-3 text-end font-mono text-sm font-semibold tabular-nums">
                    {formatMinor(data.totalOutstandingMinor)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
