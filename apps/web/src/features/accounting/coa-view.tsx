'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { BookOpen, Pencil, Plus, Power, PowerOff } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectItem } from '@/components/ui/select';
import { ApiError } from '@/lib/api';
import { ModuleGate, useEntitlements } from '@/lib/entitlements';
import { Can } from '@/lib/permissions';

import type { AccountingAccount } from '@/lib/api/resources';

import { accountingErrorKey } from './errors';
import { useAccountingCoa, useAccountingMutations } from './hooks';
import { accountDisplayName } from './labels';
import { AccountingPageHeader } from './page-header';

const accountTypeSchema = z.enum(['asset', 'liability', 'equity', 'revenue', 'expense']);
const ACCOUNT_TYPES = accountTypeSchema.options;

/** First digit of a 4-digit code block per account type (ACC-5 chart shape). */
const CODE_BLOCK: Record<z.infer<typeof accountTypeSchema>, number> = {
  asset: 1000,
  liability: 2000,
  equity: 3000,
  revenue: 4000,
  expense: 5000,
};

/**
 * Technical system keys (e.g. `coa.bank`, `modules.accounting.coa.cash`) are
 * NOT account names — they are i18n keys the seeded chart used internally.
 * The Add Account name must be a plain business label ("Bank Misr Account").
 */
function isTechnicalKey(name: string): boolean {
  const trimmed = name.trim();
  if (/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(trimmed)) return true;
  return /^(coa|accounting|modules|errors|common)\./i.test(trimmed);
}

/** Does the code fall inside the type's numeric block (1000–1999 asset, …)? */
function codeInBlock(code: string, type: z.infer<typeof accountTypeSchema>): boolean {
  const n = Number(code);
  const block = CODE_BLOCK[type];
  return Number.isInteger(n) && n >= block && n < block + 1000;
}

/**
 * Next free code for a type: the highest existing code in the block + 100
 * (the seeded SME chart steps by 100), or the block start + 100 when the
 * block is empty. Falls back to the block start + 100 if the block is full.
 */
function nextCodeForType(type: z.infer<typeof accountTypeSchema>, existing: AccountingAccount[]): string {
  const block = CODE_BLOCK[type];
  const inBlock = existing
    .map((account) => account.code)
    .filter((code) => /^\d{4}$/.test(code))
    .map(Number)
    .filter((n) => n >= block && n < block + 1000);
  if (inBlock.length === 0) return String(block + 100);
  const next = Math.max(...inBlock) + 100;
  return String(next < block + 1000 ? next : block + 100);
}

const accountFormSchema = z
  .object({
    code: z.string().regex(/^\d{4}$/, '4-digit code'),
    // Plain text only — a dotted technical key is rejected up front so the
    // chart never shows coa.bank-style placeholders for a custom account.
    name: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .refine((name) => !isTechnicalKey(name), 'plain business name'),
    type: accountTypeSchema,
  })
  .refine((values) => codeInBlock(values.code, values.type), {
    message: 'code block must match the type',
    path: ['code'],
  });

type AccountFormValues = z.infer<typeof accountFormSchema>;

/**
 * ChartOfAccountsView — the account list (ACC-5). The first read lazily seeds
 * the default SME chart server-side. Adding custom accounts is a plan-gated
 * capability (ACC-16, `advanced_coa`): the form renders only when the org's
 * entitlement carries the feature, and the API enforces it server-side too.
 * Custom accounts can be renamed and activated/deactivated from the ACTIONS
 * column; system accounts are immutable there (ACC-5). Every account links to
 * its general-ledger detail view.
 */
export function ChartOfAccountsView() {
  const t = useTranslations('modules.accounting');
  const global = useTranslations();
  const locale = useLocale();
  const { data, isPending } = useAccountingCoa();
  const { createAccount, updateAccount } = useAccountingMutations();
  const { data: billing } = useEntitlements();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // The Add Account form is collapsed by default so the chart is the primary
  // focus on load; '+ Add account' expands it (same as journal/invoices).
  const [formOpen, setFormOpen] = useState(false);

  // ─── Table filters (client-side — the chart is fully loaded) ────────────
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');

  const displayName = (account: AccountingAccount) => accountDisplayName(account, locale, t);

  const filteredAccounts = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (data?.items ?? []).filter((account) => {
      if (typeFilter !== '' && account.type !== typeFilter) return false;
      if (query === '') return true;
      const name = displayName(account).toLowerCase();
      return name.includes(query) || account.code.includes(query);
    });
  }, [data?.items, search, typeFilter, locale, t]);

  // ACC-16: custom accounts are gated on the advanced_coa plan feature.
  const advancedCoaEnabled =
    billing?.entitlements.find((e) => e.moduleKey === 'accounting')?.features?.includes('advanced_coa') ?? false;

  const form = useForm<AccountFormValues>({
    resolver: zodResolver(accountFormSchema),
    defaultValues: { code: nextCodeForType('expense', []), name: '', type: 'expense' },
    // Validate as the user types so the plain-name / code-block hints appear
    // immediately and the Add button stays disabled until the form is valid.
    mode: 'onChange',
  });

  // The code auto-generates per type until the user types one manually —
  // "automatically map or generate the code" for the chosen account type.
  const codeTouchedRef = useRef(false);
  const watchedType = form.watch('type');
  useEffect(() => {
    if (codeTouchedRef.current) return;
    form.setValue('code', nextCodeForType(watchedType, data?.items ?? []));
  }, [watchedType, data?.items, form]);

  // The Add button mirrors the schema: a plain business name + a 4-digit code
  // inside the type's block are required before an account can be created.
  const watchedForm = form.watch(['code', 'name', 'type']);
  const nameValid = watchedForm[1].trim() !== '' && !isTechnicalKey(watchedForm[1]);
  const codeValid = /^\d{4}$/.test(watchedForm[0]) && codeInBlock(watchedForm[0], watchedForm[2]);
  const canCreate = nameValid && codeValid;

  const handleCreate = async (values: AccountFormValues) => {
    setError(null);
    setSuccess(null);
    try {
      await createAccount.mutateAsync({ code: values.code, name: values.name, type: values.type });
      setSuccess(t('coa.addedMessage', { code: values.code }));
      const next = nextCodeForType(
        values.type,
        (data?.items ?? []).concat({
          id: '',
          code: values.code,
          nameI18n: {},
          type: values.type,
          isSystem: false,
          isActive: true,
        }),
      );
      codeTouchedRef.current = false;
      form.reset({ code: next, name: '', type: values.type });
    } catch (err) {
      setError(err instanceof ApiError ? t(accountingErrorKey(err.code)) : t('errors.unknown'));
    }
  };

  // ─── Edit modal (custom accounts) + activate/deactivate confirm ──────────
  const [editingAccount, setEditingAccount] = useState<AccountingAccount | null>(null);
  const [editName, setEditName] = useState('');
  const [toggleTarget, setToggleTarget] = useState<AccountingAccount | null>(null);

  const openEdit = (account: AccountingAccount) => {
    setEditingAccount(account);
    setEditName(account.nameI18n.en ?? '');
  };

  const handleSaveEdit = async () => {
    if (!editingAccount) return;
    const name = editName.trim();
    if (!name || isTechnicalKey(name)) return;
    setError(null);
    setSuccess(null);
    try {
      await updateAccount.mutateAsync({ accountId: editingAccount.id, name });
      setSuccess(t('coa.editedMessage'));
      setEditingAccount(null);
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
      <div className="space-y-6 animate-fade-in">
        <AccountingPageHeader
          icon={BookOpen}
          title={t('coa.title')}
          subtitle={t('coa.subtitle')}
          actions={
            advancedCoaEnabled && (
              <Can permission="accounting:coa:manage">
                <Button
                  variant={formOpen ? 'outline' : 'default'}
                  onClick={() => setFormOpen((open) => !open)}
                  aria-expanded={formOpen}
                >
                  <Plus className="size-4" aria-hidden="true" />
                  <span className="ms-1">{formOpen ? t('coa.hideForm') : t('coa.addAccountAction')}</span>
                </Button>
              </Can>
            )
          }
        />

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

        {advancedCoaEnabled && formOpen && (
          <Can permission="accounting:coa:manage">
            <Card className="border-primary/20">
              <CardContent className="pt-6">
                <form className="space-y-4" onSubmit={(event) => void form.handleSubmit(handleCreate)(event)}>
                  <div className="grid gap-4 md:grid-cols-3">
                    <div className="space-y-2">
                      <Label htmlFor="coa-code">{t('coa.fields.code')}</Label>
                      <Input
                        id="coa-code"
                        className="font-mono"
                        inputMode="numeric"
                        placeholder="5200"
                        aria-invalid={form.formState.errors.code ? true : undefined}
                        {...form.register('code', {
                          onChange: () => {
                            codeTouchedRef.current = true;
                          },
                        })}
                      />
                      {form.formState.errors.code ? (
                        <p className="text-xs text-destructive">
                          {form.formState.errors.code.message === '4-digit code'
                            ? t('coa.fields.codeHint')
                            : form.formState.errors.code.message}
                        </p>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          {t('coa.fields.codeAuto', { code: nextCodeForType(watchedType, data?.items ?? []) })}
                        </p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="coa-name">{t('coa.fields.name')}</Label>
                      <Input id="coa-name" dir="auto" {...form.register('name')} />
                      {form.formState.errors.name && (
                        <p className="text-xs text-destructive">
                          {form.formState.errors.name.message === 'plain business name'
                            ? t('coa.fields.namePlainHint')
                            : t('coa.fields.nameRequired')}
                        </p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="coa-type">{t('coa.fields.type')}</Label>
                      <Select
                        id="coa-type"
                        value={form.watch('type')}
                        onValueChange={(value) => {
                          codeTouchedRef.current = false;
                          form.setValue('type', accountTypeSchema.parse(value));
                        }}
                      >
                        {ACCOUNT_TYPES.map((type) => (
                          <SelectItem key={type} value={type}>
                            {t(`coa.types.${type}`)}
                          </SelectItem>
                        ))}
                      </Select>
                    </div>
                  </div>
                  {/* The submit button sits in its own row — aligned with the
                      journal/invoices forms instead of the field grid. */}
                  <div className="flex justify-end">
                    <Button type="submit" loading={createAccount.isPending} disabled={!canCreate}>
                      {t('coa.addAccount')}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </Can>
        )}

        {/* Search + type filter above the chart (client-side). */}
        <div className="flex flex-wrap items-end gap-3 rounded-md border bg-card p-3">
          <div className="min-w-48 flex-1 space-y-1">
            <Label htmlFor="coa-search">{t('coa.search')}</Label>
            <Input
              id="coa-search"
              type="search"
              dir="auto"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('coa.searchPlaceholder')}
            />
          </div>
          <div className="w-48 space-y-1">
            <Label htmlFor="coa-type-filter">{t('coa.filterType')}</Label>
            <Select
              id="coa-type-filter"
              value={typeFilter}
              onValueChange={(value) => setTypeFilter(value === '' ? '' : accountTypeSchema.parse(value))}
            >
              <SelectItem value="">{t('coa.allTypes')}</SelectItem>
              {ACCOUNT_TYPES.map((type) => (
                <SelectItem key={type} value={type}>
                  {t(`coa.types.${type}`)}
                </SelectItem>
              ))}
            </Select>
          </div>
          {(search !== '' || typeFilter !== '') && (
            <p className="text-xs text-muted-foreground">
              {t('coa.shownCount', { shown: String(filteredAccounts.length), total: String(data?.items.length ?? 0) })}
            </p>
          )}
        </div>

        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-start text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-3 text-start font-medium">{t('coa.tableCode')}</th>
                    <th className="px-4 py-3 text-start font-medium">{t('coa.tableName')}</th>
                    <th className="px-4 py-3 text-start font-medium">{t('coa.tableType')}</th>
                    <th className="px-4 py-3 text-start font-medium">{t('coa.tableSystem')}</th>
                    <th className="px-4 py-3 text-start font-medium">{t('coa.tableStatus')}</th>
                    <th className="px-4 py-3 text-end font-medium">{t('coa.tableActions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {isPending && !data ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                        {t('common.loading')}
                      </td>
                    </tr>
                  ) : (data?.items.length ?? 0) === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                        {t('coa.empty')}
                      </td>
                    </tr>
                  ) : filteredAccounts.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                        {t('coa.noMatches')}
                      </td>
                    </tr>
                  ) : (
                    filteredAccounts.map((account) => (
                      <tr key={account.id} className="transition-colors hover:bg-accent/30">
                        <td className="px-4 py-3">
                          <Link
                            href={`/${locale}/m/accounting/coa/${account.id}`}
                            className="font-mono text-xs text-primary underline-offset-4 hover:underline"
                          >
                            {account.code}
                          </Link>
                        </td>
                        <td className="px-4 py-3 font-medium" dir="auto">
                          <Link
                            href={`/${locale}/m/accounting/coa/${account.id}`}
                            className="underline-offset-4 hover:underline"
                          >
                            {displayName(account)}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{t(`coa.types.${account.type}`)}</td>
                        <td className="px-4 py-3">
                          {account.isSystem ? (
                            <Badge variant="secondary">{t('coa.system')}</Badge>
                          ) : (
                            <span className="text-muted-foreground">{t('common.none')}</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {account.isActive ? (
                            <Badge variant="outline">{t('coa.active')}</Badge>
                          ) : (
                            <Badge variant="secondary">{t('coa.inactive')}</Badge>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {account.isSystem ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <Can permission="accounting:coa:manage">
                              <div className="flex items-center justify-end gap-1">
                                <Button variant="ghost" size="sm" onClick={() => openEdit(account)}>
                                  <Pencil className="size-4" aria-hidden="true" />
                                  <span className="ms-1">{global('common.edit')}</span>
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setToggleTarget(account)}
                                  aria-label={account.isActive ? t('coa.deactivateAction') : t('coa.activateAction')}
                                >
                                  {account.isActive ? (
                                    <PowerOff className="size-4" aria-hidden="true" />
                                  ) : (
                                    <Power className="size-4" aria-hidden="true" />
                                  )}
                                  <span className="ms-1">
                                    {account.isActive ? t('coa.deactivate') : t('coa.activate')}
                                  </span>
                                </Button>
                              </div>
                            </Can>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Edit modal — custom accounts only (system accounts are immutable, ACC-5). */}
        {editingAccount && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-account-title"
          >
            <button
              type="button"
              className="absolute inset-0 bg-black/50 cursor-default"
              onClick={() => setEditingAccount(null)}
              aria-hidden="true"
              tabIndex={-1}
            />
            <Card className="relative w-full max-w-md animate-fade-in">
              <CardHeader className="pb-3">
                <CardTitle id="edit-account-title" className="text-base">
                  {t('coa.editTitle', { code: editingAccount.code })}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 pt-0">
                <div className="space-y-2">
                  <Label htmlFor="edit-account-name">{t('coa.fields.name')}</Label>
                  <Input
                    id="edit-account-name"
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
              </CardContent>
              <CardFooter className="justify-end gap-2 border-t pt-3">
                <Button variant="outline" onClick={() => setEditingAccount(null)}>
                  {t('invoices.cancel')}
                </Button>
                <Button
                  onClick={() => void handleSaveEdit()}
                  loading={updateAccount.isPending}
                  disabled={editName.trim() === '' || isTechnicalKey(editName)}
                >
                  {global('common.save')}
                </Button>
              </CardFooter>
            </Card>
          </div>
        )}

        <ConfirmDialog
          open={toggleTarget !== null}
          title={toggleTarget?.isActive ? t('coa.deactivateTitle') : t('coa.activateTitle')}
          description={
            toggleTarget
              ? toggleTarget.isActive
                ? t('coa.deactivateBody', { code: toggleTarget.code, name: displayName(toggleTarget) })
                : t('coa.activateBody', { code: toggleTarget.code, name: displayName(toggleTarget) })
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
