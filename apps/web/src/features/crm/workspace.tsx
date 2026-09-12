'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  Activity,
  Building2,
  ChevronLeft,
  ChevronRight,
  Handshake,
  Mail,
  Merge,
  Phone,
  Plus,
  Search,
  User,
  UserX,
  Users,
  X,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectItem } from '@/components/ui/select';
import { locales } from '@/i18n/routing';
import { useSession } from '@/lib/auth/session-context';
import { Can, hasPermission } from '@/lib/permissions';

import { CRM_PAGE_SIZE } from '@/lib/api/resources';

import { DueBadge } from './due-badge';
import { crmErrorKey } from './errors';
import { ActivityForm, DealForm, Field, FormCard } from './forms';
import {
  presetListParams,
  scopePresetListParams,
  useActivitiesList,
  useCompaniesList,
  useContactsList,
  useCrmData,
  usePipelines,
  useTeams,
  useCrmMutations,
  useCurrencies,
  useDealsBoard,
  useOrgBaseCurrency,
  useOrgMembers,
  type CrmListPreset,
} from './hooks';
import { formatMinorAmount } from './money';
import { MergeContactsDialog } from './merge-contacts-dialog';
import { MoveDealDialog } from './move-deal-dialog';
import { FilterPresetChips, ViewToggle } from './table-shared';
import { companyFormSchema, contactFormSchema, type CompanyFormValues, type ContactFormValues } from './schemas';
import { StageMenu } from './stage-menu';

export type CrmView = 'contacts' | 'companies' | 'deals' | 'activities';

/** Sentinel value for the "Unassigned" option in the assignee filter. */
const ACTIVITY_ASSIGNEE_UNASSIGNED = '__unassigned__';

export function CrmWorkspace({ view }: { view: CrmView }) {
  const t = useTranslations('modules.crm');
  const { user } = useSession();
  const data = useCrmData();
  const mutations = useCrmMutations();
  const [showForm, setShowForm] = useState(false);
  const [showMerge, setShowMerge] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [contactSearch, setContactSearch] = useState('');
  const [companyFilter, setCompanyFilter] = useState('');
  const [contactPage, setContactPage] = useState(1);
  const [contactPreset, setContactPreset] = useState<CrmListPreset>('all');
  const [companySearch, setCompanySearch] = useState('');
  const [companyPage, setCompanyPage] = useState(1);
  const [companyPreset, setCompanyPreset] = useState<CrmListPreset>('all');
  // TEAM-4: ownership filtering on the deals board and activities cards uses
  // the SAME unified preset chips as the contacts/companies lists — the server
  // clamps each preset to the caller's ceiling, so no scope state is needed.
  const [dealPreset, setDealPreset] = useState<CrmListPreset>('all');
  const [dealSearch, setDealSearch] = useState('');
  // CRM-17: which pipeline the kanban shows. Empty = the org default (first
  // in the list — the API orders the default first).
  const [dealPipelineId, setDealPipelineId] = useState('');
  const [activityPreset, setActivityPreset] = useState<CrmListPreset>('all');
  const [activitySearch, setActivitySearch] = useState('');
  // Unfiltered by default ? activities due on any date (or undated) all
  // appear; the From/To inputs narrow the range when the user sets them.
  const [activityFromDate, setActivityFromDate] = useState('');
  const [activityToDate, setActivityToDate] = useState('');
  // Empty = all assignees; UNASSIGNED = no assignee; otherwise the selected
  // user's id (CRM-14 filter).
  const [activityAssignee, setActivityAssignee] = useState('');
  // Empty = all; 'open' = not completed; 'completed' = completed.
  const [activityStatus, setActivityStatus] = useState('');
  const [activityPage, setActivityPage] = useState(1);

  const contactsList = useContactsList({
    page: contactPage,
    pageSize: CRM_PAGE_SIZE,
    ...presetListParams(contactPreset, user?.id),
    ...(contactSearch ? { search: contactSearch } : {}),
    ...(companyFilter ? { companyId: companyFilter } : {}),
  });
  const companiesList = useCompaniesList({
    page: companyPage,
    pageSize: CRM_PAGE_SIZE,
    ...presetListParams(companyPreset, user?.id),
    ...(companySearch ? { search: companySearch } : {}),
  });
  // CRM-17: the pipelines the caller can see, and the one currently on the
  // board (the default when nothing is picked).
  const pipelines = usePipelines();
  const activePipeline = pipelines.data?.find((p) => p.id === dealPipelineId) ?? pipelines.data?.[0] ?? null;
  // The board fetches one query per pipeline stage — each response carries its
  // own exact count and value total (server-side sum, independent of the API's
  // 100-row clamp). Columns are All Time by default (no date bounds); the
  // search box and scope/pool toggles narrow every column.
  const dealsBoard = useDealsBoard(activePipeline?.stages, dealSearch, dealPreset, activePipeline?.id);
  const activitiesList = useActivitiesList({
    page: activityPage,
    pageSize: CRM_PAGE_SIZE,
    ...scopePresetListParams(activityPreset),
    ...(activitySearch ? { search: activitySearch } : {}),
    ...(activityFromDate ? { fromDate: activityFromDate } : {}),
    ...(activityToDate ? { toDate: activityToDate } : {}),
    ...(activityAssignee === ACTIVITY_ASSIGNEE_UNASSIGNED
      ? { unassigned: true }
      : activityAssignee
        ? { assigneeUserId: activityAssignee }
        : {}),
    ...(activityStatus ? { completed: activityStatus === 'completed' } : {}),
  });

  // Run a mutation, close the form on success, surface a localized message on
  // failure (the API returns machine-readable codes, never user-facing text).
  const submit = (promise: Promise<unknown>, close: () => void) =>
    promise
      .then(() => {
        close();
        setSubmitError(null);
      })
      .catch((err: unknown) => setSubmitError(t(crmErrorKey(err))));
  // One-click assignee chips toggle the same state the dropdown below uses
  // ('' = all assignees) and reset to page 1, keeping every control in sync.
  const toggleActivityAssignee = (value: string) => {
    setActivityAssignee(activityAssignee === value ? '' : value);
    setActivityPage(1);
  };
  const titles = {
    contacts: t('contacts.title'),
    companies: t('companies.title'),
    deals: t('deals.title'),
    activities: t('activities.title'),
  };
  const icons = { contacts: Users, companies: Building2, deals: Handshake, activities: Activity };
  const Icon = icons[view];

  return (
    <div className="space-y-6 animate-fade-in">
      <header className="flex flex-col gap-4 rounded-xl border bg-card p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="rounded-lg bg-primary p-2 text-primary-foreground">
            <Icon className="size-5" />
          </span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{titles[view]}</h1>
            <p className="text-sm text-muted-foreground">{t(`${view}.subtitle`)}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {view === 'activities' && user?.id && (
            <Button
              // `secondary` reads as a pressed filter chip ? distinct from the
              // primary "Add activity" action next to it.
              variant={activityAssignee === user.id ? 'secondary' : 'outline'}
              aria-pressed={activityAssignee === user.id}
              onClick={() => toggleActivityAssignee(user.id)}
            >
              <User />
              {t('activities.assignedToMe')}
            </Button>
          )}
          {view === 'activities' && (
            <Button
              variant={activityAssignee === ACTIVITY_ASSIGNEE_UNASSIGNED ? 'secondary' : 'outline'}
              aria-pressed={activityAssignee === ACTIVITY_ASSIGNEE_UNASSIGNED}
              onClick={() => toggleActivityAssignee(ACTIVITY_ASSIGNEE_UNASSIGNED)}
            >
              <UserX />
              {t('activities.unassigned')}
            </Button>
          )}
          {view === 'contacts' && (
            <Can permission="crm:contact:write">
              <Button variant="outline" onClick={() => setShowMerge(!showMerge)}>
                <Merge />
                {t('contacts.merge')}
              </Button>
            </Can>
          )}
          <Can
            permission={`crm:${view === 'companies' ? 'company' : view === 'deals' ? 'deal' : view === 'activities' ? 'activity' : 'contact'}:write`}
          >
            <Button onClick={() => setShowForm(!showForm)}>
              <Plus />
              {t(`${view}.create`)}
            </Button>
          </Can>
        </div>
      </header>

      {submitError && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          <p>{submitError}</p>
          <Button variant="ghost" size="sm" aria-label={t('errors.dismiss')} onClick={() => setSubmitError(null)}>
            <X className="size-4" />
          </Button>
        </div>
      )}

      {showForm && view === 'contacts' && (
        <ContactForm
          onSubmit={(v) =>
            submit(
              mutations.createContact.mutateAsync({
                firstName: v.firstName,
                lastName: v.lastName,
                email: v.email || null,
                phone: v.phone || null,
                secondaryPhone: v.secondaryPhone || null,
                companyId: v.companyId || null,
                ...(v.ownerUserId ? { ownerUserId: v.ownerUserId } : v.ownerUserId === '' ? { ownerUserId: null } : {}),
                ...(v.ownerTeamId ? { ownerTeamId: v.ownerTeamId } : v.ownerTeamId === '' ? { ownerTeamId: null } : {}),
                preferredLocale: v.preferredLocale || null,
                preferredCurrency: v.preferredCurrency || null,
              }),
              () => setShowForm(false),
            )
          }
          pending={mutations.createContact.isPending}
          onClose={() => setShowForm(false)}
        />
      )}
      {showForm && view === 'companies' && (
        <CompanyForm
          onSubmit={(v) =>
            submit(
              mutations.createCompany.mutateAsync({
                name: v.name,
                domain: v.domain || null,
                industry: v.industry || null,
                address: {
                  street: v.addressStreet || null,
                  city: v.addressCity || null,
                  state: v.addressState || null,
                  postalCode: v.addressPostalCode || null,
                  country: v.addressCountry || null,
                },
                ...(v.ownerUserId ? { ownerUserId: v.ownerUserId } : v.ownerUserId === '' ? { ownerUserId: null } : {}),
                ...(v.ownerTeamId ? { ownerTeamId: v.ownerTeamId } : v.ownerTeamId === '' ? { ownerTeamId: null } : {}),
              }),
              () => setShowForm(false),
            )
          }
          pending={mutations.createCompany.isPending}
          onClose={() => setShowForm(false)}
        />
      )}
      {showForm && view === 'deals' && (
        <DealForm
          contacts={data.contacts.data?.items ?? []}
          companies={data.companies.data?.items ?? []}
          onSubmit={(v) =>
            submit(
              mutations.createDeal.mutateAsync({
                title: v.title,
                contactId: v.contactId || null,
                companyId: v.companyId || null,
                value: { amountMinor: v.amountMinor, currency: v.currency },
                // CRM-17: '' = the org default pipeline / its first stage.
                ...(v.pipelineId ? { pipelineId: v.pipelineId } : {}),
                ...(v.stageId ? { stageId: v.stageId } : {}),
                ...(v.ownerUserId ? { ownerUserId: v.ownerUserId } : v.ownerUserId === '' ? { ownerUserId: null } : {}),
                ...(v.ownerTeamId ? { ownerTeamId: v.ownerTeamId } : v.ownerTeamId === '' ? { ownerTeamId: null } : {}),
              }),
              () => setShowForm(false),
            )
          }
          pending={mutations.createDeal.isPending}
          onClose={() => setShowForm(false)}
        />
      )}
      {showForm && view === 'activities' && (
        <ActivityForm
          onSubmit={(v) =>
            submit(
              mutations.createActivity.mutateAsync({
                type: v.type,
                subject: v.subject,
                dueAt: v.dueAt ? new Date(v.dueAt).toISOString() : null,
              }),
              () => setShowForm(false),
            )
          }
          pending={mutations.createActivity.isPending}
          onClose={() => setShowForm(false)}
        />
      )}
      <MergeContactsDialog open={showMerge} onOpenChange={setShowMerge} />

      {view === 'contacts' && (
        <ContactsSection
          list={contactsList}
          companies={data.companies.data?.items ?? []}
          search={contactSearch}
          onSearch={(value) => {
            setContactSearch(value);
            setContactPage(1);
          }}
          companyFilter={companyFilter}
          onCompanyFilter={(value) => {
            setCompanyFilter(value);
            setContactPage(1);
          }}
          preset={contactPreset}
          onPreset={(preset) => {
            setContactPreset(preset);
            setContactPage(1);
          }}
          page={contactPage}
          onPage={setContactPage}
        />
      )}
      {view === 'companies' && (
        <CompaniesSection
          list={companiesList}
          deals={data.deals.data?.items ?? []}
          search={companySearch}
          onSearch={(value) => {
            setCompanySearch(value);
            setCompanyPage(1);
          }}
          preset={companyPreset}
          onPreset={(preset) => {
            setCompanyPreset(preset);
            setCompanyPage(1);
          }}
          page={companyPage}
          onPage={setCompanyPage}
        />
      )}
      {view === 'deals' && (
        <DealsSection
          board={dealsBoard}
          pipeline={activePipeline}
          pipelines={pipelines.data}
          activePipelineId={activePipeline?.id ?? ''}
          onPipeline={setDealPipelineId}
          search={dealSearch}
          onSearch={setDealSearch}
          preset={dealPreset}
          onPreset={setDealPreset}
          onClaim={(dealId) => {
            void submit(
              mutations.updateDealOwnership.mutateAsync({ id: dealId, input: { ownerUserId: user?.id ?? null } }),
              () => {},
            );
          }}
          movePending={mutations.moveDeal.isPending}
          onMove={(dealId, stageId, lostReasonCode) =>
            submit(
              mutations.moveDeal.mutateAsync({ dealId, stageId, ...(lostReasonCode ? { lostReasonCode } : {}) }),
              () => {},
            )
          }
        />
      )}
      {view === 'activities' && (
        <ActivitiesSection
          list={activitiesList}
          search={activitySearch}
          onSearch={(value) => {
            setActivitySearch(value);
            setActivityPage(1);
          }}
          preset={activityPreset}
          onPreset={(preset) => {
            setActivityPreset(preset);
            setActivityPage(1);
          }}
          fromDate={activityFromDate}
          toDate={activityToDate}
          onFromDate={setActivityFromDate}
          onToDate={setActivityToDate}
          assignee={activityAssignee}
          status={activityStatus}
          myUserId={user?.id}
          onAssignee={(value) => {
            setActivityAssignee(value);
            setActivityPage(1);
          }}
          onStatus={(value) => {
            setActivityStatus(value);
            setActivityPage(1);
          }}
          page={activityPage}
          onPage={setActivityPage}
          onComplete={(id) => {
            void submit(mutations.completeActivity.mutateAsync(id), () => {});
          }}
        />
      )}
    </div>
  );
}

export function ContactForm({
  onSubmit,
  pending,
  onClose,
}: {
  onSubmit: (v: ContactFormValues) => Promise<unknown>;
  pending: boolean;
  /** Optional close button next to the submit action ? closes the form. */
  onClose?: () => void;
}) {
  const t = useTranslations('modules.crm');
  const { data: currencies } = useCurrencies();
  const data = useCrmData();
  const { user, permissions } = useSession();
  const { data: teams } = useTeams();
  const { data: membersData } = useOrgMembers();
  const isAdminForOwner = hasPermission(permissions ?? [], 'platform:members:assign-role');
  const myTeamMemberIds = (() => {
    if (isAdminForOwner) return null;
    const myTeams = (teams ?? []).filter((team) => team.memberUserIds.includes(user?.id ?? ''));
    if (myTeams.length === 0) return [user?.id ?? ''].filter(Boolean);
    const ids = new Set<string>();
    for (const team of myTeams) for (const uid of team.memberUserIds) ids.add(uid);
    if (user?.id) ids.add(user.id);
    return [...ids];
  })();
  const teamMembers = (membersData ?? [])
    .filter((m) => m.status === 'active')
    .filter((m) => !myTeamMemberIds || myTeamMemberIds.includes(m.userId));
  const form = useForm<ContactFormValues>({
    resolver: zodResolver(contactFormSchema),
    defaultValues: {
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      secondaryPhone: '',
      companyId: '',
      preferredLocale: '',
      preferredCurrency: '',
      ownerUserId: user?.id ?? '',
      ownerTeamId: teams?.[0]?.id ?? '',
    },
  });
  const phoneError = form.formState.errors.phone ? t('errors.invalidPhone') : undefined;
  const secondaryPhoneError = form.formState.errors.secondaryPhone ? t('errors.invalidPhone') : undefined;
  // Default owner to current user + primary team once session/teams load
  useEffect(() => {
    if (user?.id && !form.getValues('ownerUserId')) form.setValue('ownerUserId', user.id);
  }, [user?.id]);
  useEffect(() => {
    if (teams?.[0]?.id && !form.getValues('ownerTeamId')) form.setValue('ownerTeamId', teams[0].id);
  }, [teams]);
  return (
    <FormCard>
      <form className="grid gap-4 md:grid-cols-2" onSubmit={(event) => void form.handleSubmit(onSubmit)(event)}>
        <Field
          label={t('fields.firstName')}
          htmlFor="contact-first-name"
          error={form.formState.errors.firstName?.message}
        >
          <Input id="contact-first-name" dir="auto" {...form.register('firstName')} />
        </Field>
        <Field label={t('fields.lastName')} htmlFor="contact-last-name" error={form.formState.errors.lastName?.message}>
          <Input id="contact-last-name" dir="auto" {...form.register('lastName')} />
        </Field>
        <Field label={t('fields.email')} htmlFor="contact-email" error={form.formState.errors.email?.message}>
          <Input id="contact-email" type="email" {...form.register('email')} />
        </Field>
        <Field label={t('fields.phone')} error={phoneError}>
          <Input {...form.register('phone')} />
        </Field>
        <Field label={t('fields.secondaryPhone')} error={secondaryPhoneError}>
          <Input {...form.register('secondaryPhone')} />
        </Field>
        <Field label={t('fields.company')} error={undefined}>
          <Select
            value={form.watch('companyId')}
            onValueChange={(v) => form.setValue('companyId', v)}
            {...form.register('companyId')}
          >
            <SelectItem value="">{t('common.none')}</SelectItem>
            {data.companies.data?.items?.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
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
        <Field label={t('fields.preferredLocale')} error={undefined}>
          <Select
            value={form.watch('preferredLocale')}
            onValueChange={(v) => form.setValue('preferredLocale', v)}
            {...form.register('preferredLocale')}
          >
            <SelectItem value="">{t('common.none')}</SelectItem>
            {locales.map((code) => (
              <SelectItem key={code} value={code}>
                {code}
              </SelectItem>
            ))}
          </Select>
        </Field>
        <Field label={t('fields.preferredCurrency')} error={undefined}>
          <Select
            value={form.watch('preferredCurrency')}
            onValueChange={(v) => form.setValue('preferredCurrency', v)}
            {...form.register('preferredCurrency')}
          >
            <SelectItem value="">{t('common.none')}</SelectItem>
            {currencies?.map((c) => (
              <SelectItem key={c.code} value={c.code}>
                {c.code}
              </SelectItem>
            ))}
          </Select>
        </Field>
        <div className="flex flex-wrap gap-2 md:col-span-2 md:justify-self-start">
          <Button loading={pending}>{t('contacts.create')}</Button>
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

export function CompanyForm({
  onSubmit,
  pending,
  onClose,
}: {
  onSubmit: (v: CompanyFormValues) => Promise<unknown>;
  pending: boolean;
  /** Optional close button next to the submit action ? closes the form. */
  onClose?: () => void;
}) {
  const t = useTranslations('modules.crm');
  const { user, permissions } = useSession();
  const { data: teams } = useTeams();
  const { data: membersData } = useOrgMembers();
  const isAdminForOwner = hasPermission(permissions ?? [], 'platform:members:assign-role');
  const myTeamMemberIds = (() => {
    if (isAdminForOwner) return null;
    const myTeams = (teams ?? []).filter((team) => team.memberUserIds.includes(user?.id ?? ''));
    if (myTeams.length === 0) return [user?.id ?? ''].filter(Boolean);
    const ids = new Set<string>();
    for (const team of myTeams) for (const uid of team.memberUserIds) ids.add(uid);
    if (user?.id) ids.add(user.id);
    return [...ids];
  })();
  const teamMembers = (membersData ?? [])
    .filter((m) => m.status === 'active')
    .filter((m) => !myTeamMemberIds || myTeamMemberIds.includes(m.userId));
  const form = useForm<CompanyFormValues>({
    resolver: zodResolver(companyFormSchema),
    defaultValues: {
      name: '',
      domain: '',
      industry: '',
      addressStreet: '',
      addressCity: '',
      addressState: '',
      addressPostalCode: '',
      addressCountry: '',
      ownerUserId: user?.id ?? '',
      ownerTeamId: teams?.[0]?.id ?? '',
    },
  });
  useEffect(() => {
    if (user?.id && !form.getValues('ownerUserId')) form.setValue('ownerUserId', user.id);
  }, [user?.id]);
  useEffect(() => {
    if (teams?.[0]?.id && !form.getValues('ownerTeamId')) form.setValue('ownerTeamId', teams[0].id);
  }, [teams]);
  return (
    <FormCard>
      <form className="grid gap-4" onSubmit={(event) => void form.handleSubmit(onSubmit)(event)}>
        <div className="grid gap-4 md:grid-cols-3">
          <Field label={t('fields.name')} error={undefined}>
            <Input dir="auto" {...form.register('name')} />
          </Field>
          <Field label={t('fields.domain')} error={undefined}>
            <Input {...form.register('domain')} />
          </Field>
          <Field label={t('fields.industry')} error={undefined}>
            <Input dir="auto" {...form.register('industry')} />
          </Field>
        </div>
        <fieldset className="rounded-lg border p-4">
          <legend className="text-sm font-medium text-muted-foreground">{t('fields.address')}</legend>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label={t('fields.addressStreet')} error={undefined}>
              <Input dir="auto" {...form.register('addressStreet')} />
            </Field>
            <Field label={t('fields.addressCity')} error={undefined}>
              <Input dir="auto" {...form.register('addressCity')} />
            </Field>
            <Field label={t('fields.addressState')} error={undefined}>
              <Input dir="auto" {...form.register('addressState')} />
            </Field>
            <Field label={t('fields.addressPostalCode')} error={undefined}>
              <Input {...form.register('addressPostalCode')} />
            </Field>
            <Field label={t('fields.addressCountry')} error={undefined}>
              <Input dir="auto" {...form.register('addressCountry')} />
            </Field>
          </div>
        </fieldset>
        <div className="grid gap-4 md:grid-cols-2">
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
        </div>
        <div className="flex flex-wrap gap-2 justify-self-start">
          <Button loading={pending}>{t('companies.create')}</Button>
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

export function Empty({ loading }: { loading: boolean }) {
  const t = useTranslations('modules.crm');
  return (
    <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
      {loading ? t('common.loading') : t('common.empty')}
    </div>
  );
}

export function Pagination({
  page,
  pageSize,
  total,
  loading,
  onChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  loading: boolean;
  onChange: (page: number) => void;
}) {
  const t = useTranslations('modules.crm');
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted-foreground">{t('list.total', { count: total })}</p>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => onChange(page - 1)}>
          <ChevronLeft className="rtl:rotate-180" />
          {t('list.previous')}
        </Button>
        <span className="text-sm tabular-nums text-muted-foreground">{t('list.pageOf', { page, pages })}</span>
        <Button variant="outline" size="sm" disabled={page >= pages || loading} onClick={() => onChange(page + 1)}>
          {t('list.next')}
          <ChevronRight className="rtl:rotate-180" />
        </Button>
      </div>
    </div>
  );
}

function ContactsSection({
  list,
  companies,
  search,
  onSearch,
  companyFilter,
  onCompanyFilter,
  preset,
  onPreset,
  page,
  onPage,
}: {
  list: ReturnType<typeof useContactsList>;
  companies: Array<{ id: string; name: string }>;
  search: string;
  onSearch: (value: string) => void;
  companyFilter: string;
  onCompanyFilter: (value: string) => void;
  preset: CrmListPreset;
  onPreset: (preset: CrmListPreset) => void;
  page: number;
  onPage: (page: number) => void;
}) {
  const t = useTranslations('modules.crm');
  const locale = useLocale();
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder={t('contacts.searchPlaceholder')}
            className="ps-9"
          />
        </div>
        <ViewToggle
          cardsHref={`/${locale}/m/crm/contacts`}
          tableHref={`/${locale}/m/crm/contacts/table`}
          active="cards"
          cardsLabel={t('contacts.viewCards')}
          tableLabel={t('contacts.viewTable')}
        />
      </div>
      {/* Same two-row filter-bar shape as the other CRM list pages: search row,
          then a single filter row with labeled controls. */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">{t('contacts.filterCompany')}</Label>
          <Select
            value={companyFilter}
            onValueChange={onCompanyFilter}
            aria-label={t('contacts.filterCompany')}
            className="h-9 w-48"
          >
            <SelectItem value="">{t('contacts.allCompanies')}</SelectItem>
            {companies.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </Select>
        </div>
        <FilterPresetChips value={preset} onChange={onPreset} />
      </div>
      <ContactList
        items={list.data?.items ?? []}
        companies={companies}
        loading={list.isPending}
        total={list.data?.total ?? 0}
        page={page}
        pageSize={list.data?.pageSize ?? CRM_PAGE_SIZE}
        onPage={onPage}
      />
    </div>
  );
}

function CompaniesSection({
  list,
  deals,
  search,
  onSearch,
  preset,
  onPreset,
  page,
  onPage,
}: {
  list: ReturnType<typeof useCompaniesList>;
  deals: Array<{
    companyId: string | null;
    status: 'open' | 'won' | 'lost';
    value: { amountMinor: string; currency: string };
    baseAmountMinor?: string | null;
  }>;
  search: string;
  onSearch: (value: string) => void;
  preset: CrmListPreset;
  onPreset: (preset: CrmListPreset) => void;
  page: number;
  onPage: (page: number) => void;
}) {
  const t = useTranslations('modules.crm');
  const locale = useLocale();
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder={t('companies.searchPlaceholder')}
            className="ps-9"
          />
        </div>
        <ViewToggle
          cardsHref={`/${locale}/m/crm/companies`}
          tableHref={`/${locale}/m/crm/companies/table`}
          active="cards"
          cardsLabel={t('companies.viewCards')}
          tableLabel={t('companies.viewTable')}
        />
      </div>
      {/* Same two-row filter-bar shape as the other CRM list pages: search row,
          then a single filter row. */}
      <div className="flex flex-wrap items-end gap-2">
        <FilterPresetChips value={preset} onChange={onPreset} />
      </div>
      <CompanyList
        items={list.data?.items ?? []}
        deals={deals}
        loading={list.isPending}
        total={list.data?.total ?? 0}
        page={page}
        pageSize={list.data?.pageSize ?? CRM_PAGE_SIZE}
        onPage={onPage}
      />
    </div>
  );
}

function DealsSection({
  board,
  pipeline,
  pipelines,
  activePipelineId,
  onPipeline,
  search,
  onSearch,
  preset,
  onPreset,
  onClaim,
  movePending,
  onMove,
}: {
  board: ReturnType<typeof useDealsBoard>;
  /** The pipeline currently on the board (CRM-17). */
  pipeline: { stages: PipelineStage[]; id?: string } | null | undefined;
  /** Every pipeline visible to the caller (CRM-17 switcher). */
  pipelines:
    | Array<{ id: string; nameI18n: Record<string, string>; isDefault?: boolean; ownerTeamId?: string | null }>
    | undefined;
  activePipelineId: string;
  onPipeline: (pipelineId: string) => void;
  search: string;
  onSearch: (value: string) => void;
  preset: CrmListPreset;
  onPreset: (preset: CrmListPreset) => void;
  onClaim: (dealId: string) => void;
  movePending: boolean;
  onMove: (dealId: string, stageId: string, lostReasonCode?: string) => Promise<unknown>;
}) {
  const t = useTranslations('modules.crm');
  const locale = useLocale();
  const baseCurrency = useOrgBaseCurrency();
  const { data: currencies } = useCurrencies();
  const baseExponent = currencies?.find((c) => c.code === baseCurrency)?.exponent ?? 2;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder={t('deals.searchPlaceholder')}
            className="ps-9"
          />
        </div>
        {/* Board / Table view switch ? both pages carry it so the All-time
            shortcut and the toggle always land on the matching view. */}
        <ViewToggle
          cardsHref={`/${locale}/m/crm/deals`}
          tableHref={`/${locale}/m/crm/deals/table`}
          active="cards"
          cardsLabel={t('deals.viewBoard')}
          tableLabel={t('deals.viewTable')}
        />
      </div>
      {/* Pipeline switcher + ownership chips share the filter row (CRM-17). */}
      <div className="flex flex-wrap items-end gap-2">
        {(pipelines?.length ?? 0) > 1 && (
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">{t('deals.pipeline')}</Label>
            <Select
              value={activePipelineId}
              onValueChange={onPipeline}
              aria-label={t('deals.pipeline')}
              className="h-9 w-52"
            >
              {pipelines?.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {(p.nameI18n[locale] ?? p.nameI18n.en) + (p.isDefault ? t('deals.defaultSuffix') : '')}
                </SelectItem>
              ))}
            </Select>
          </div>
        )}
        <FilterPresetChips value={preset} onChange={onPreset} />
      </div>
      <PipelineBoard
        pipeline={pipeline}
        board={board}
        baseCurrency={baseCurrency}
        baseExponent={baseExponent}
        movePending={movePending}
        onMove={onMove}
        onClaim={onClaim}
      />
    </div>
  );
}

function ActivitiesSection({
  list,
  search,
  onSearch,
  preset,
  onPreset,
  fromDate,
  toDate,
  onFromDate,
  onToDate,
  assignee,
  onAssignee,
  status,
  onStatus,
  myUserId,
  page,
  onPage,
  onComplete,
}: {
  list: ReturnType<typeof useActivitiesList>;
  search: string;
  onSearch: (value: string) => void;
  preset: CrmListPreset;
  onPreset: (preset: CrmListPreset) => void;
  fromDate: string;
  toDate: string;
  onFromDate: (value: string) => void;
  onToDate: (value: string) => void;
  /** Selected assignee user id, '' for all assignees, or UNASSIGNED. */
  assignee: string;
  onAssignee: (value: string) => void;
  /** '' = all, 'open' = not completed, 'completed' = completed. */
  status: string;
  onStatus: (value: string) => void;
  /** Current user id ? powers the "Assigned to me" shortcut. */
  myUserId: string | undefined;
  page: number;
  onPage: (page: number) => void;
  onComplete: (id: string) => void;
}) {
  const t = useTranslations('modules.crm');
  const locale = useLocale();
  const { data: members } = useOrgMembers();
  // Active members only (CRM-14: only active members can hold assignments).
  const activeMembers = (members ?? []).filter((m) => m.status === 'active');
  return (
    <div className="space-y-4">
      {/* Search + view toggle in their own row — filters sit below, matching
          the other CRM list pages. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder={t('activities.searchPlaceholder')}
            className="ps-9"
          />
        </div>
        <ViewToggle
          cardsHref={`/${locale}/m/crm/activities`}
          tableHref={`/${locale}/m/crm/activities/table`}
          active="cards"
          cardsLabel={t('activities.viewCards')}
          tableLabel={t('activities.viewTable')}
        />
      </div>
      {/* Ownership chips on their own row — the exact same component and
          placement as the contacts/companies list pages (TEAM-4). The labeled
          dropdown filters stay in the row below. */}
      <FilterPresetChips value={preset} onChange={onPreset} />
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">{t('activities.assigneeFilter')}</Label>
          <Select
            value={assignee}
            onValueChange={onAssignee}
            className="h-9 w-44"
            aria-label={t('activities.assigneeFilter')}
          >
            <SelectItem value="">{t('activities.allAssignees')}</SelectItem>
            <SelectItem value={ACTIVITY_ASSIGNEE_UNASSIGNED}>{t('activities.unassigned')}</SelectItem>
            {myUserId && <SelectItem value={myUserId}>{t('activities.assignedToMe')}</SelectItem>}
            {activeMembers
              .filter((m) => m.userId !== myUserId)
              .map((m) => (
                <SelectItem key={m.userId} value={m.userId}>
                  {m.name || m.email}
                </SelectItem>
              ))}
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">{t('activities.statusFilter')}</Label>
          <Select
            value={status}
            onValueChange={onStatus}
            className="h-9 w-40"
            aria-label={t('activities.statusFilter')}
          >
            <SelectItem value="">{t('activities.allStatuses')}</SelectItem>
            <SelectItem value="open">{t('activities.open')}</SelectItem>
            <SelectItem value="completed">{t('activities.completed')}</SelectItem>
          </Select>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">{t('activities.fromDate')}</Label>
            <Input type="date" value={fromDate} onChange={(event) => onFromDate(event.target.value)} className="h-9" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">{t('activities.toDate')}</Label>
            <Input type="date" value={toDate} onChange={(event) => onToDate(event.target.value)} className="h-9" />
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onFromDate('');
              onToDate('');
            }}
          >
            {t('activities.clearDates')}
          </Button>
        </div>
      </div>
      <ActivityList items={list.data?.items ?? []} loading={list.isPending} onComplete={onComplete} />
      <Pagination
        page={page}
        pageSize={list.data?.pageSize ?? CRM_PAGE_SIZE}
        total={list.data?.total ?? 0}
        loading={list.isPending}
        onChange={onPage}
      />
    </div>
  );
}

function ContactList({
  items,
  companies,
  loading,
  total,
  page,
  pageSize,
  onPage,
}: {
  items: Array<{
    id: string;
    firstName: string;
    lastName: string;
    email: string | null;
    phone: string | null;
    companyId: string | null;
  }>;
  companies: Array<{ id: string; name: string }>;
  loading: boolean;
  total: number;
  page: number;
  pageSize: number;
  onPage: (page: number) => void;
}) {
  const t = useTranslations('modules.crm');
  const locale = useLocale();
  if (total === 0 && !loading) return <Empty loading={false} />;
  return (
    <div className="space-y-4">
      {items.length ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => {
            const companyName = companies.find((c) => c.id === item.companyId)?.name;
            // The card root is NOT a link so the mailto:/tel: quick actions
            // stay separate interactive elements; the name carries navigation.
            return (
              <div key={item.id} className="group">
                <Card className="h-full transition-colors group-hover:border-primary/50 group-hover:bg-accent">
                  <CardHeader>
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle dir="auto" className="truncate">
                        <Link
                          href={`/${locale}/m/crm/contacts/${item.id}`}
                          className="hover:underline"
                          // Remember this list location so the detail page's
                          // Back button returns here, not a fixed default.
                          onClick={() =>
                            sessionStorage.setItem(
                              'crm.contacts.back',
                              `${window.location.pathname}${window.location.search}`,
                            )
                          }
                        >
                          {item.firstName} {item.lastName}
                        </Link>
                      </CardTitle>
                      {companyName && (
                        <Badge variant="outline" className="shrink-0 truncate text-xs">
                          {companyName}
                        </Badge>
                      )}
                    </div>
                    <CardDescription>{item.email ?? item.phone}</CardDescription>
                  </CardHeader>
                  {(item.email || item.phone) && (
                    <CardContent className="flex flex-wrap items-center gap-1 pt-0">
                      {item.email && (
                        <Button
                          asChild
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          aria-label={t('contacts.emailAction')}
                        >
                          <a href={`mailto:${item.email}`}>
                            <Mail className="size-4" />
                          </a>
                        </Button>
                      )}
                      {item.phone && (
                        <Button
                          asChild
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          aria-label={t('contacts.callAction')}
                        >
                          <a href={`tel:${item.phone.replace(/\s+/g, '')}`}>
                            <Phone className="size-4" />
                          </a>
                        </Button>
                      )}
                    </CardContent>
                  )}
                </Card>
              </div>
            );
          })}
        </div>
      ) : (
        <Empty loading={loading} />
      )}
      <Pagination page={page} pageSize={pageSize} total={total} loading={loading} onChange={onPage} />
    </div>
  );
}

function CompanyList({
  items,
  deals,
  loading,
  total,
  page,
  pageSize,
  onPage,
}: {
  items: Array<{ id: string; name: string; domain: string | null; industry: string | null }>;
  deals: Array<{
    companyId: string | null;
    status: 'open' | 'won' | 'lost';
    value: { amountMinor: string; currency: string };
    baseAmountMinor?: string | null;
  }>;
  loading: boolean;
  total: number;
  page: number;
  pageSize: number;
  onPage: (page: number) => void;
}) {
  const t = useTranslations('modules.crm');
  const locale = useLocale();
  const baseCurrency = useOrgBaseCurrency();
  // Active-deal metrics per company. Sums use the org-base snapshot when the
  // FX-converted amount exists and the deal's own minor units otherwise ?
  // integer minor units only, never floating-point money.
  const openMetricsById = new Map<string, { count: number; totalMinor: string }>();
  for (const deal of deals) {
    if (!deal.companyId || deal.status !== 'open') continue;
    const entry = openMetricsById.get(deal.companyId) ?? { count: 0, totalMinor: '0' };
    entry.count += 1;
    entry.totalMinor = (BigInt(entry.totalMinor) + BigInt(deal.baseAmountMinor ?? deal.value.amountMinor)).toString();
    openMetricsById.set(deal.companyId, entry);
  }
  if (total === 0 && !loading) return <Empty loading={false} />;
  return (
    <div className="space-y-4">
      {items.length ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => {
            const metrics = openMetricsById.get(item.id);
            return (
              <Link
                key={item.id}
                href={`/${locale}/m/crm/companies/${item.id}`}
                className="group"
                // Remember this list location so the detail page's Back button
                // returns here (cards/table + filters), not a fixed default.
                onClick={() =>
                  sessionStorage.setItem('crm.companies.back', `${window.location.pathname}${window.location.search}`)
                }
              >
                <Card className="h-full transition-colors group-hover:border-primary/50 group-hover:bg-accent">
                  <CardHeader>
                    <CardTitle dir="auto">{item.name}</CardTitle>
                    <CardDescription>{item.domain ?? item.industry}</CardDescription>
                  </CardHeader>
                  {metrics && (
                    <CardContent className="flex flex-wrap items-center gap-2 pt-0">
                      <Badge variant="secondary">{t('companies.activeDeals', { count: metrics.count })}</Badge>
                      <Badge
                        variant="outline"
                        aria-label={`${t('companies.openValue')}: ${formatMinorAmount(metrics.totalMinor, baseCurrency, { locale })}`}
                        className="font-mono tabular-nums"
                      >
                        {formatMinorAmount(metrics.totalMinor, baseCurrency, { locale })}
                      </Badge>
                    </CardContent>
                  )}
                </Card>
              </Link>
            );
          })}
        </div>
      ) : (
        <Empty loading={loading} />
      )}
      <Pagination page={page} pageSize={pageSize} total={total} loading={loading} onChange={onPage} />
    </div>
  );
}

type DealCard = {
  id: string;
  title: string;
  stageId: string;
  contactName?: string | null;
  companyName?: string | null;
  value: { amountMinor: string; currency: string };
  status: string;
};

type PipelineStage = {
  id: string;
  nameI18n: Record<string, string>;
  isLost: boolean;
  /** CRM-17: computed win rate, or the configured probability while no deal has resolved. */
  probability?: number;
  successPercent?: number;
  resolvedDeals?: number;
};

function PipelineBoard({
  pipeline,
  board,
  baseCurrency,
  baseExponent,
  onClaim,
  movePending,
  onMove,
}: {
  pipeline: { stages: PipelineStage[] } | null | undefined;
  board: ReturnType<typeof useDealsBoard>;
  baseCurrency: string;
  baseExponent: number;
  onClaim: (dealId: string) => void;
  movePending: boolean;
  onMove: (dealId: string, stageId: string, lostReasonCode?: string) => Promise<unknown>;
}) {
  const locale = useLocale();
  const t = useTranslations('modules.crm');
  const { permissions } = useSession();
  const canMove = hasPermission(permissions, 'crm:deal:write');
  const [pendingMove, setPendingMove] = useState<{ deal: DealCard; toStage: PipelineStage } | null>(null);

  // undefined = the pipeline query is still in flight (no column queries were
  // created yet, so `board` is empty); null = the org genuinely has no
  // pipeline yet — an empty board.
  if (pipeline === undefined) return <Empty loading />;
  if (pipeline === null) return <Empty loading={false} />;

  const stageName = (stage: PipelineStage) => stage.nameI18n[locale] ?? stage.nameI18n.en ?? '';
  // All cards across every column, for the drop handler and lost-stage dialog.
  const allDeals = board.flatMap((column) => column.data?.items ?? []);

  const statusLabels: Record<string, string> = {
    open: 'detail.statusOpen',
    won: 'detail.statusWon',
    lost: 'detail.statusLost',
  };

  /** Lost stages need a reason (CRM-7) ? collect it in the dialog first. */
  function requestMove(deal: DealCard, toStage: PipelineStage) {
    if (!canMove || toStage.id === deal.stageId) return;
    if (toStage.isLost) setPendingMove({ deal, toStage });
    else void onMove(deal.id, toStage.id);
  }

  return (
    <div className="flex snap-x gap-4 overflow-x-auto pb-4">
      {pipeline.stages.map((stage, index) => {
        const column = board[index];
        const columnDeals = column?.data?.items ?? [];
        // Exact count + org-base value total come from the server (per-column
        // query), not from the rendered slice ? clamping never skews them.
        const total = column?.data?.total ?? 0;
        const totalValue = column?.data?.totalValueBaseMinor ?? '0';
        return (
          <section
            key={stage.id}
            className="flex min-w-72 flex-1 snap-start flex-col rounded-xl border bg-muted/30 p-3"
            onDragOver={(event) => {
              if (canMove) event.preventDefault();
            }}
            onDrop={(event) => {
              if (!canMove) return;
              const dealId = event.dataTransfer.getData('text/crm-deal');
              const deal = allDeals.find((d) => d.id === dealId);
              if (deal) requestMove(deal, stage);
            }}
          >
            <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
              <h2 className="font-semibold">{stageName(stage)}</h2>
              <Badge variant="secondary">{total}</Badge>
            </div>
            {/* CRM-17: stage success bar — computed win rate once any deal
                has resolved from the stage, the configured probability
                otherwise (resolvedDeals = 0 marks the fallback). */}
            <div
              className="mb-2"
              title={
                (stage.resolvedDeals ?? 0) > 0
                  ? t('deals.successRate', { percent: stage.successPercent ?? 0 })
                  : t('deals.estimatedRate', { percent: stage.successPercent ?? 0 })
              }
            >
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${Math.min(100, Math.max(0, stage.successPercent ?? 0))}%` }}
                />
              </div>
              <p className="mt-1 text-start text-[11px] text-muted-foreground">
                {(stage.resolvedDeals ?? 0) > 0
                  ? t('deals.successRate', { percent: stage.successPercent ?? 0 })
                  : t('deals.estimatedRate', { percent: stage.successPercent ?? 0 })}
              </p>
            </div>
            <p className="mb-3 flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>{t('deals.columnTotal')}</span>
              <span className="font-mono tabular-nums text-foreground">
                {formatMinorAmount(totalValue, baseCurrency, { locale, exponent: baseExponent })}
              </span>
            </p>
            {/* Internal scroll per column — long columns never push the board */}
            <div className="max-h-[calc(100vh-300px)] min-h-24 space-y-2 overflow-y-auto pe-1">
              {columnDeals.length === 0 && (
                // Per-column empty state — the board structure always stays
                // visible, even when every column is filtered to zero.
                <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
                  {column?.isPending ? t('common.loading') : t('deals.noDeals')}
                </p>
              )}
              {columnDeals.map((deal) => (
                <article
                  key={deal.id}
                  draggable={canMove}
                  onDragStart={(event) => event.dataTransfer.setData('text/crm-deal', deal.id)}
                  className="cursor-grab rounded-lg border bg-card p-3 shadow-sm transition-colors focus-within:ring-2 focus-within:ring-ring hover:border-primary/40"
                >
                  <div className="flex items-start justify-between gap-2">
                    <Link
                      href={`/${locale}/m/crm/deals/${deal.id}`}
                      className="block min-w-0 rounded hover:underline"
                      // Remember this list location so the deal detail page's
                      // Back button returns here (board/table + filters).
                      onClick={() =>
                        sessionStorage.setItem('crm.deals.back', `${window.location.pathname}${window.location.search}`)
                      }
                    >
                      <p className="truncate font-medium" dir="auto">
                        {deal.title}
                      </p>
                    </Link>
                    <div className="flex shrink-0 items-center gap-1">
                      {deal.status !== 'open' && (
                        <Badge variant={deal.status === 'won' ? 'default' : 'destructive'}>
                          {t(statusLabels[deal.status] ?? 'detail.statusOpen')}
                        </Badge>
                      )}
                      {onClaim && deal.ownerUserId === null && deal.ownerTeamId && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() => onClaim(deal.id)}
                        >
                          {t('deals.claim')}
                        </Button>
                      )}
                      <Can permission="crm:deal:write">
                        <StageMenu
                          options={pipeline.stages.map((s) => ({
                            id: s.id,
                            label: stageName(s),
                            isCurrent: s.id === deal.stageId,
                            isLost: s.isLost,
                          }))}
                          disabled={movePending}
                          ariaLabel={t('deals.move')}
                          onSelect={(stageId) => {
                            const toStage = pipeline.stages.find((s) => s.id === stageId);
                            if (toStage) requestMove(deal, toStage);
                          }}
                        />
                      </Can>
                    </div>
                  </div>
                  <p className="mt-2 font-mono text-sm tabular-nums">
                    {formatMinorAmount(deal.value.amountMinor, deal.value.currency, { locale })}
                  </p>
                  {(deal.contactName || deal.companyName) && (
                    <p className="mt-1.5 truncate text-xs text-muted-foreground" dir="auto">
                      {[deal.contactName, deal.companyName].filter(Boolean).join(' ? ')}
                    </p>
                  )}
                </article>
              ))}
              {total > columnDeals.length && (
                <p className="text-center text-xs text-muted-foreground">
                  {t('deals.shownCount', { shown: columnDeals.length, total })}
                </p>
              )}
            </div>
          </section>
        );
      })}

      <MoveDealDialog
        open={pendingMove !== null}
        dealTitle={pendingMove?.deal.title ?? ''}
        toStageName={pendingMove ? stageName(pendingMove.toStage) : ''}
        requiresReason={pendingMove?.toStage.isLost ?? false}
        pending={movePending}
        onConfirm={(reason) => {
          if (!pendingMove) return;
          void onMove(pendingMove.deal.id, pendingMove.toStage.id, reason).finally(() => setPendingMove(null));
        }}
        onCancel={() => {
          if (!movePending) setPendingMove(null);
        }}
      />
    </div>
  );
}

function ActivityList({
  items,
  loading,
  onComplete,
}: {
  items: Array<{
    id: string;
    type: string;
    subject: string;
    dueAt: string | null;
    completedAt: string | null;
    assignedToUserId: string | null;
    relatedType: string | null;
    relatedId: string | null;
    relatedName?: string | null;
    dealStageNameI18n?: Record<string, string> | null;
  }>;
  loading: boolean;
  onComplete: (id: string) => void;
}) {
  const t = useTranslations('modules.crm');
  const locale = useLocale();
  const { data: members } = useOrgMembers();
  if (!items.length) return <Empty loading={loading} />;
  return (
    <div className="space-y-3">
      {' '}
      {items.map((item) => {
        const assignee = members?.find((m) => m.userId === item.assignedToUserId);
        // Deep link for the related entity (contact / company / deal).
        const relatedHref =
          item.relatedType && item.relatedId
            ? `/${locale}/m/crm/${{ contact: 'contacts', company: 'companies', deal: 'deals' }[item.relatedType] ?? 'activities'}/${
                item.relatedId
              }`
            : null;
        const stageLabel = item.dealStageNameI18n
          ? (item.dealStageNameI18n[locale] ?? item.dealStageNameI18n.en)
          : null;
        return (
          <Card key={item.id}>
            <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{t(`activities.types.${item.type}`)}</Badge>
                  {/* Related entity (contact / company / deal) sits between the
                      type and the subject so every row reads the same way. */}
                  {item.relatedName && relatedHref && (
                    <Link
                      href={relatedHref}
                      className="inline-flex max-w-44 items-center gap-1 truncate rounded-md border bg-muted/40 px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      dir="auto"
                    >
                      <span className="truncate">{item.relatedName}</span>
                      {stageLabel && <Badge variant="outline">{stageLabel}</Badge>}
                    </Link>
                  )}
                  <Link
                    href={`/${locale}/m/crm/activities/${item.id}`}
                    className="rounded font-medium hover:underline"
                    dir="auto"
                  >
                    {item.subject}
                  </Link>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <DueBadge dueAt={item.dueAt} completedAt={item.completedAt} />
                  {/* Keyed on the raw assignee id, not the resolved member:
                      an activity assigned to a removed member keeps its
                      assigned chip state (no false "Unassigned" claim). */}
                  {item.assignedToUserId ? (
                    assignee ? (
                      <Badge variant="secondary" className="gap-1 text-xs">
                        <User className="size-3" />
                        {assignee.name || assignee.email}
                      </Badge>
                    ) : null
                  ) : (
                    /* Mirrors the assignee chip so unassigned rows keep the
                       same visual rhythm (consistent lower-row layout). */
                    <Badge variant="secondary" className="gap-1 text-xs">
                      <UserX className="size-3" />
                      {t('activities.unassigned')}
                    </Badge>
                  )}
                  {item.dueAt && (
                    <p className="text-xs text-muted-foreground">{new Date(item.dueAt).toLocaleString()}</p>
                  )}
                </div>
              </div>
              {!item.completedAt && (
                <Can permission="crm:activity:write">
                  <Button size="sm" variant="outline" onClick={() => onComplete(item.id)}>
                    {t('activities.complete')}
                  </Button>
                </Can>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
