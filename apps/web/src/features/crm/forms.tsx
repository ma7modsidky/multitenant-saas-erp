'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { useForm } from 'react-hook-form';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectItem } from '@/components/ui/select';

import { useSession } from '@/lib/auth/session-context';
import { hasPermission } from '@/lib/permissions';

import { useCurrencies, useFxRate, useOrgBaseCurrency, usePipelines, useTeams } from './hooks';
import { useOrgMembers } from '@/lib/hooks/use-member-name';
import { convertMinorAmount, formatMinorAmount } from './money';
import { activityFormSchema, dealFormSchema, type ActivityFormValues, type DealFormValues } from './schemas';

export function FormCard({ children }: { children: React.ReactNode }) {
  return (
    <Card className="border-primary/20">
      <CardContent className="pt-6">{children}</CardContent>
    </Card>
  );
}

export function Field({
  label,
  htmlFor,
  error,
  children,
}: {
  label: string;
  /** Associates the label with the control (a11y + getByLabel in E2E). */
  htmlFor?: string;
  error: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

export function DealForm({
  contacts,
  companies,
  initialContactId,
  initialCurrency,
  onSubmit,
  pending,
  onClose,
}: {
  contacts: Array<{ id: string; firstName: string; lastName: string }>;
  companies: Array<{ id: string; name: string }>;
  /** Prefill the contact select (contact detail page). */
  initialContactId?: string;
  /** Prefill the currency (e.g. the contact's preferred currency). */
  initialCurrency?: string;
  onSubmit: (v: DealFormValues) => Promise<unknown>;
  pending: boolean;
  /** Optional close button next to the submit action — closes the form. */
  onClose?: () => void;
}) {
  const t = useTranslations('modules.crm');
  const locale = useLocale();
  const { data: currencies } = useCurrencies();
  const baseCurrency = useOrgBaseCurrency();
  const { user, permissions } = useSession();
  const { data: teams } = useTeams();
  const { data: membersData } = useOrgMembers();
  const isAdminForOwner = hasPermission(permissions ?? [], 'platform:members:assign-role');
  const myTeamMemberIds = (() => {
    if (isAdminForOwner) return null;
    const myTeams = (teams ?? []).filter((team) => team.memberUserIds.includes(user?.id ?? ''));
    if (myTeams.length === 0) return [user?.id ?? ''].filter(Boolean) as string[];
    const ids = new Set<string>();
    for (const team of myTeams) for (const uid of team.memberUserIds) ids.add(uid);
    if (user?.id) ids.add(user.id);
    return [...ids];
  })();
  const teamMembers = (membersData ?? [])
    .filter((m) => m.status === 'active')
    .filter((m) => !myTeamMemberIds || myTeamMemberIds.includes(m.userId));
  const form = useForm<DealFormValues>({
    resolver: zodResolver(dealFormSchema),
    defaultValues: {
      title: '',
      contactId: initialContactId ?? '',
      companyId: '',
      amountMinor: '0',
      currency: initialCurrency ?? baseCurrency,
      pipelineId: '',
      stageId: '',
      ownerUserId: user?.id ?? '',
      ownerTeamId: teams?.[0]?.id ?? '',
    },
  });
  const amountMinor = form.watch('amountMinor');
  const currency = form.watch('currency');
  // CRM-17: the pipelines the caller can see, and the stage dropdown's
  // contents follow the selected pipeline ('' = the org default, which the
  // API orders first — mirror that for the stage list).
  const { data: pipelines } = usePipelines();
  const selectedPipeline = pipelines?.find((p) => p.id === form.watch('pipelineId')) ?? pipelines?.[0] ?? null;
  const pipelineStageList = selectedPipeline
    ? [...selectedPipeline.stages].sort((a, b) => a.position - b.position)
    : [];
  const crossCurrency = currency !== '' && currency !== baseCurrency;
  const { data: rate, isPending: ratePending } = useFxRate(
    crossCurrency ? currency : null,
    crossCurrency ? baseCurrency : null,
  );
  const validAmount = /^\d+$/.test(amountMinor) && BigInt(amountMinor) > 0n;

  // Live CRM-8 preview: the base-currency amount the API will snapshot on
  // create. Same-currency deals need no conversion; otherwise the converted
  // amount mirrors the backend `Money.convertTo` (bigint, truncated).
  const preview = useMemo(() => {
    if (!validAmount) return null;
    const currencyInfo = currencies?.find((c) => c.code === (crossCurrency ? baseCurrency : currency));
    if (!crossCurrency) {
      return formatMinorAmount(amountMinor, baseCurrency, {
        locale,
        ...(currencyInfo ? { exponent: currencyInfo.exponent } : {}),
      });
    }
    if (!rate) return null;
    return formatMinorAmount(convertMinorAmount(amountMinor, rate.rate), baseCurrency, {
      locale,
      ...(currencyInfo ? { exponent: currencyInfo.exponent } : {}),
    });
  }, [validAmount, amountMinor, currency, baseCurrency, crossCurrency, rate, currencies, locale]);
  const rateMissing = crossCurrency && !ratePending && !rate && validAmount;

  return (
    <FormCard>
      <form className="grid gap-4 md:grid-cols-2" onSubmit={(event) => void form.handleSubmit(onSubmit)(event)}>
        <Field label={t('fields.title')} htmlFor="deal-title" error={undefined}>
          <Input id="deal-title" dir="auto" {...form.register('title')} />
        </Field>
        <Field label={t('fields.contact')} htmlFor="deal-contact" error={undefined}>
          {/* Custom Select is controlled: value/onValueChange drive the custom
              trigger; register() keeps name/ref/validation wiring. */}
          <Select
            id="deal-contact"
            value={form.watch('contactId')}
            onValueChange={(v) => form.setValue('contactId', v)}
            {...form.register('contactId')}
          >
            <SelectItem value="">{t('common.none')}</SelectItem>
            {contacts.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.firstName} {c.lastName}
              </SelectItem>
            ))}
          </Select>
        </Field>
        <Field label={t('fields.company')} error={undefined}>
          <Select
            value={form.watch('companyId')}
            onValueChange={(v) => form.setValue('companyId', v)}
            {...form.register('companyId')}
          >
            <SelectItem value="">{t('common.none')}</SelectItem>
            {companies.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </Select>
        </Field>
        <Field label={t('fields.amountMinor')} htmlFor="deal-amount" error={undefined}>
          <div className="flex gap-2">
            <Input id="deal-amount" className="font-mono" inputMode="numeric" {...form.register('amountMinor')} />
            <Select
              aria-label={t('fields.currency')}
              className="w-28"
              value={form.watch('currency')}
              onValueChange={(v) => form.setValue('currency', v)}
              {...form.register('currency')}
            >
              {!currencies ? (
                <SelectItem value="">{t('common.loading')}</SelectItem>
              ) : (
                currencies.map((c) => (
                  <SelectItem key={c.code} value={c.code}>
                    {c.code}
                  </SelectItem>
                ))
              )}
            </Select>
          </div>
          {rateMissing && (
            <p className="text-xs text-destructive">
              {t('deals.rateUnavailable', { from: currency, to: baseCurrency })}
            </p>
          )}
          {preview && (
            <p className="text-xs font-medium text-foreground">{t('deals.previewAmount', { amount: preview })}</p>
          )}
          <p className="text-xs text-muted-foreground">{t('deals.currencyHint', { currency: baseCurrency })}</p>
        </Field>
        <Field label={t('fields.pipeline')} error={undefined}>
          <Select
            value={selectedPipeline?.id ?? ''}
            onValueChange={(v) => {
              form.setValue('pipelineId', v);
              // The stage list just changed — reset the entry stage so the
              // deal lands on the new pipeline's first stage (or an explicit
              // pick) instead of a stage from the previous pipeline.
              form.setValue('stageId', '');
            }}
          >
            {!pipelines ? (
              <SelectItem value="">{t('common.loading')}</SelectItem>
            ) : (
              pipelines.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {(p.nameI18n[locale] ?? p.nameI18n.en) + (p.isDefault ? t('deals.defaultSuffix') : '')}
                </SelectItem>
              ))
            )}
          </Select>
        </Field>
        <Field label={t('fields.stage')} error={undefined}>
          <Select value={form.watch('stageId') ?? ''} onValueChange={(v) => form.setValue('stageId', v)}>
            <SelectItem value="">{t('fields.stageFirst')}</SelectItem>
            {pipelineStageList.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.nameI18n[locale] ?? s.nameI18n.en}
              </SelectItem>
            ))}
          </Select>
        </Field>
        <Field label={t('fields.owner')} error={undefined}>
          <Select
            value={form.watch('ownerUserId') ?? ''}
            onValueChange={(v) => form.setValue('ownerUserId', v)}
            {...form.register('ownerUserId')}
          >
            <SelectItem value="">{t('common.none')}</SelectItem>
            {teamMembers.map((m) => (
              <SelectItem key={m.userId} value={m.userId}>
                {m.name || m.email}
              </SelectItem>
            ))}
          </Select>
        </Field>
        <Field label={t('fields.ownerTeam')} error={undefined}>
          <Select
            value={form.watch('ownerTeamId') ?? ''}
            onValueChange={(v) => form.setValue('ownerTeamId', v)}
            {...form.register('ownerTeamId')}
          >
            <SelectItem value="">{t('common.none')}</SelectItem>
            {(teams ?? []).map((team) => (
              <SelectItem key={team.id} value={team.id}>
                {team.name}
              </SelectItem>
            ))}
          </Select>
        </Field>
        <div className="flex flex-wrap gap-2 md:col-span-2 md:justify-self-start">
          <Button loading={pending}>{t('deals.create')}</Button>
          {onClose && (
            <Button type="button" variant="outline" onClick={onClose}>
              {t('common.close')}
            </Button>
          )}
        </div>
      </form>
    </FormCard>
  );
}

// Activity type values — mirrors `ActivityFormValues['type']`; the Select hands
// back a plain string, so narrow it before setValue (no `as` casts per
// no-restricted-syntax). Same shape as the guard in details.tsx.
const isActivityType = (value: string): value is ActivityFormValues['type'] =>
  ['call', 'meeting', 'task', 'email'].some((type) => type === value);

export function ActivityForm({
  onSubmit,
  pending,
  onClose,
}: {
  onSubmit: (v: ActivityFormValues) => Promise<unknown>;
  pending: boolean;
  /** Optional close button next to the submit action — closes the form. */
  onClose?: () => void;
}) {
  const t = useTranslations('modules.crm');
  const form = useForm<ActivityFormValues>({
    resolver: zodResolver(activityFormSchema),
    defaultValues: { type: 'task', subject: '', dueAt: '' },
  });
  return (
    <FormCard>
      <form className="grid gap-4 md:grid-cols-3" onSubmit={(event) => void form.handleSubmit(onSubmit)(event)}>
        <Field label={t('fields.type')} error={undefined}>
          <Select
            value={form.watch('type')}
            onValueChange={(v) => {
              if (isActivityType(v)) form.setValue('type', v);
            }}
            {...form.register('type')}
          >
            <SelectItem value="call">{t('activities.types.call')}</SelectItem>
            <SelectItem value="meeting">{t('activities.types.meeting')}</SelectItem>
            <SelectItem value="task">{t('activities.types.task')}</SelectItem>
            <SelectItem value="email">{t('activities.types.email')}</SelectItem>
          </Select>
        </Field>
        <Field label={t('fields.subject')} error={undefined}>
          <Input dir="auto" {...form.register('subject')} />
        </Field>
        <Field label={t('fields.dueAt')} error={undefined}>
          <Input type="datetime-local" {...form.register('dueAt')} />
        </Field>
        <div className="flex flex-wrap gap-2 md:col-span-3 md:justify-self-start">
          <Button loading={pending}>{t('activities.create')}</Button>
          {onClose && (
            <Button type="button" variant="outline" onClick={onClose}>
              {t('common.close')}
            </Button>
          )}
        </div>
      </form>
    </FormCard>
  );
}
