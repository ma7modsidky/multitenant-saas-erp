'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, Building2, Handshake, History, MapPin, Pencil, Plus, Users, X } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { Can } from '@/lib/permissions';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectItem } from '@/components/ui/select';
import { locales } from '@/i18n/routing';

import { CalendarClock, MessageSquare, Send } from 'lucide-react';

import { DueBadge } from './due-badge';
import { crmErrorKey } from './errors';
import { ActivityForm, DealForm } from './forms';
import { formatMinorAmount } from './money';
import { MoveDealDialog } from './move-deal-dialog';
import {
  useCrmActivityDetail,
  useCrmCompanyDetail,
  useCrmContactDetail,
  useCrmData,
  useCrmDealDetail,
  useCrmMutations,
  useCrmNotes,
  useCurrencies,
  useMemberName,
  useOrgMembers,
} from './hooks';
import {
  companyFormSchema,
  contactFormSchema,
  type ActivityFormValues,
  type CompanyFormValues,
  type ContactFormValues,
  type DealFormValues,
} from './schemas';

// ─── Display helpers ────────────────────────────────────────────────────────

function formatDate(iso: string | null | undefined, locale: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
}

function formatDuration(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/** Read a string field off the company address record (unknown values → null). */
function addressField(address: Record<string, unknown> | undefined, key: string): string | null {
  const value = address?.[key];
  return typeof value === 'string' ? value : null;
}

/**
 * Pipeline stage display name for a stage id, localized. Shared by the
 * contact/company/deal detail views; a missing stage degrades to a dash.
 */
function stageName(
  pipeline: { stages: Array<{ id: string; nameI18n: Record<string, string> }> } | null | undefined,
  stageId: string | null,
  locale: string,
): string {
  const stage = pipeline?.stages.find((s) => s.id === stageId);
  if (!stage) return '—';
  return stage.nameI18n[locale] ?? stage.nameI18n.en ?? '—';
}

// ─── Shared building blocks ─────────────────────────────────────────────────

function DetailField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="text-sm">{value}</dd>
    </div>
  );
}

function DetailCard({
  icon: Icon,
  title,
  action,
  children,
}: {
  icon: typeof Users;
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div className="flex items-center gap-2">
          <Icon className="size-4 text-muted-foreground" />
          <CardTitle className="text-base">{title}</CardTitle>
        </div>
        {action}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function ErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
    >
      <p>{message}</p>
      <Button variant="ghost" size="sm" onClick={onDismiss}>
        <X className="size-4" />
      </Button>
    </div>
  );
}

function RelatedRow({
  href,
  icon: Icon,
  title,
  meta,
}: {
  href: string;
  icon: typeof Users;
  title: string;
  meta?: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-lg border bg-card p-3 text-sm shadow-sm transition-colors hover:bg-accent"
    >
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate" dir="auto">
        {title}
      </span>
      {meta && <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">{meta}</span>}
    </Link>
  );
}

// ─── Notes section ─────────────────────────────────────────────────────────

function NotesSection({
  relatedType,
  relatedId,
}: {
  relatedType: 'contact' | 'company' | 'deal' | 'activity';
  relatedId: string;
}) {
  const t = useTranslations('modules.crm');
  const locale = useLocale();
  const notes = useCrmNotes(relatedType, relatedId);
  const mutations = useCrmMutations();
  const [body, setBody] = useState('');
  const [showNew, setShowNew] = useState(false);

  const submit = () => {
    if (!body.trim()) return;
    mutations.createNote.mutate(
      { body: body.trim(), relatedType, relatedId },
      {
        onSuccess: () => {
          setBody('');
          setShowNew(false);
        },
      },
    );
  };

  const items = notes.data?.items ?? [];

  return (
    <DetailCard
      icon={MessageSquare}
      title={t('notes.title')}
      action={
        <Button variant="outline" size="sm" onClick={() => setShowNew(!showNew)}>
          <Plus />
          {t('notes.add')}
        </Button>
      }
    >
      {showNew && (
        <div className="mb-4 flex gap-2">
          <Input
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder={t('notes.placeholder')}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
          />
          <Button size="sm" onClick={submit} loading={mutations.createNote.isPending}>
            <Send />
          </Button>
        </div>
      )}
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('notes.empty')}</p>
      ) : (
        <div className="space-y-3">
          {items.map((note) => (
            <div key={note.id} className="rounded-lg border bg-muted/30 p-3 text-sm">
              <p className="whitespace-pre-wrap" dir="auto">
                {note.body}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                {note.createdByName ?? note.createdByUserId ?? t('common.system')} ·{' '}
                {formatDate(note.createdAt, locale)}
              </p>
            </div>
          ))}
        </div>
      )}
    </DetailCard>
  );
}

// ─── Contact detail ─────────────────────────────────────────────────────────

export function ContactDetailView({ id }: { id: string }) {
  const t = useTranslations('modules.crm');
  const locale = useLocale();
  const contact = useCrmContactDetail(id);
  const data = useCrmData();
  const mutations = useCrmMutations();
  const { data: currencies } = useCurrencies();
  const memberName = useMemberName();
  const [editing, setEditing] = useState(false);
  const [showNewDeal, setShowNewDeal] = useState(false);
  const [showNewActivity, setShowNewActivity] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Hoisted so every render calls the same hooks (rules-of-hooks). `values`
  // syncs the form once the record loads (deep-equal, so user edits survive).
  const c = contact.data;
  const form = useForm<ContactFormValues>({
    resolver: zodResolver(contactFormSchema),
    values: {
      firstName: c?.firstName ?? '',
      lastName: c?.lastName ?? '',
      email: c?.email ?? '',
      phone: c?.phone ?? '',
      secondaryPhone: c?.secondaryPhone ?? '',
      companyId: c?.companyId ?? '',
      preferredLocale: c?.preferredLocale ?? '',
      preferredCurrency: c?.preferredCurrency ?? '',
    },
  });

  if (contact.isPending)
    return <p className="py-10 text-center text-sm text-muted-foreground">{t('common.loading')}</p>;
  if (contact.isError || !c) return <p className="py-10 text-center text-sm text-destructive">{t('errors.unknown')}</p>;
  const companyName = data.companies.data?.items.find((item) => item.id === c.companyId)?.name;
  const relatedDeals = data.deals.data?.items.filter((deal) => deal.contactId === id) ?? [];
  const relatedActivities =
    data.activities.data?.items.filter((a) => a.relatedType === 'contact' && a.relatedId === id) ?? [];

  const submitEdit = (values: ContactFormValues) =>
    mutations.updateContact
      .mutateAsync({
        id,
        input: {
          ...values,
          // An unset company select submits '' (the form's "None" value); the
          // PATCH schema requires a UUID or null, so normalize like the create
          // flow — otherwise editing a company-less contact 400s on companyId.
          companyId: values.companyId || null,
          email: values.email || null,
          phone: values.phone || null,
          secondaryPhone: values.secondaryPhone || null,
          preferredLocale: values.preferredLocale || null,
          preferredCurrency: values.preferredCurrency || null,
        },
      })
      .then(() => {
        setEditing(false);
        setError(null);
      })
      .catch((err: unknown) => setError(t(crmErrorKey(err))));

  const submitDeal = (values: DealFormValues) =>
    mutations.createDeal
      .mutateAsync({
        title: values.title,
        contactId: id,
        companyId: values.companyId || null,
        value: { amountMinor: values.amountMinor, currency: values.currency },
      })
      .then(() => {
        setShowNewDeal(false);
        setError(null);
      })
      .catch((err: unknown) => setError(t(crmErrorKey(err))));

  const submitActivity = (values: ActivityFormValues) =>
    mutations.createActivity
      .mutateAsync({
        type: values.type,
        subject: values.subject,
        dueAt: values.dueAt ? new Date(values.dueAt).toISOString() : null,
        relatedType: 'contact',
        relatedId: id,
      })
      .then(() => {
        setShowNewActivity(false);
        setError(null);
      })
      .catch((err: unknown) => setError(t(crmErrorKey(err))));

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/${locale}/m/crm/contacts`}>
            {/* rtl:rotate-180 — the back arrow must point inline-start (right in Arabic). */}
            <ArrowLeft className="rtl:rotate-180" />
            {t('detail.back')}
          </Link>
        </Button>
        <h1 className="text-xl font-semibold" dir="auto">
          {c.firstName} {c.lastName}
        </h1>
      </div>

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      <DetailCard
        icon={Users}
        title={t('detail.contactDetails')}
        action={
          !editing && (
            <div className="flex flex-wrap gap-2">
              <Can permission="crm:contact:write">
                <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                  <Pencil />
                  {t('detail.edit')}
                </Button>
              </Can>
            </div>
          )
        }
      >
        {editing ? (
          <form className="grid gap-4 md:grid-cols-2" onSubmit={(event) => void form.handleSubmit(submitEdit)(event)}>
            <div className="space-y-2">
              <Label>{t('fields.firstName')}</Label>
              <Input dir="auto" {...form.register('firstName')} />
            </div>
            <div className="space-y-2">
              <Label>{t('fields.lastName')}</Label>
              <Input dir="auto" {...form.register('lastName')} />
            </div>
            <div className="space-y-2">
              <Label>{t('fields.email')}</Label>
              <Input type="email" {...form.register('email')} />
            </div>
            <div className="space-y-2">
              <Label>{t('fields.phone')}</Label>
              <Input {...form.register('phone')} />
            </div>
            <div className="space-y-2">
              <Label>{t('fields.secondaryPhone')}</Label>
              <Input {...form.register('secondaryPhone')} />
            </div>
            <div className="space-y-2">
              <Label>{t('fields.company')}</Label>
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
            </div>
            <div className="space-y-2">
              <Label>{t('fields.preferredLocale')}</Label>
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
            </div>
            <div className="space-y-2">
              <Label>{t('fields.preferredCurrency')}</Label>
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
            </div>
            <div className="flex gap-2 md:col-span-2">
              <Button loading={mutations.updateContact.isPending}>{t('detail.save')}</Button>
              <Button variant="ghost" type="button" onClick={() => setEditing(false)}>
                {t('detail.cancel')}
              </Button>
            </div>
          </form>
        ) : (
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <DetailField label={t('fields.email')} value={c.email ?? '—'} />
            <DetailField label={t('fields.phone')} value={c.phone ?? '—'} />
            <DetailField label={t('fields.secondaryPhone')} value={c.secondaryPhone ?? '—'} />
            <DetailField label={t('fields.company')} value={companyName ?? '—'} />
            <DetailField label={t('detail.preferredLocale')} value={c.preferredLocale ?? '—'} />
            <DetailField label={t('detail.preferredCurrency')} value={c.preferredCurrency ?? '—'} />
            <DetailField label={t('detail.created')} value={formatDate(c.createdAt, locale)} />
            <DetailField label={t('detail.updated')} value={formatDate(c.updatedAt, locale)} />
            <DetailField label={t('detail.createdBy')} value={memberName(c.createdByUserId) ?? '—'} />
            <DetailField label={t('detail.updatedBy')} value={memberName(c.updatedByUserId) ?? '—'} />
          </dl>
        )}
      </DetailCard>

      <DetailCard
        icon={Handshake}
        title={t('detail.relatedDeals')}
        action={
          <Button variant="outline" size="sm" onClick={() => setShowNewDeal(!showNewDeal)}>
            {showNewDeal ? <X /> : <Plus />}
            {showNewDeal ? t('detail.cancel') : t('detail.newDeal')}
          </Button>
        }
      >
        {showNewDeal && (
          <div className="mb-4">
            <DealForm
              contacts={[{ id: c.id, firstName: c.firstName, lastName: c.lastName }]}
              companies={data.companies.data?.items.map((item) => ({ id: item.id, name: item.name })) ?? []}
              initialContactId={c.id}
              {...(c.preferredCurrency ? { initialCurrency: c.preferredCurrency } : {})}
              onSubmit={submitDeal}
              pending={mutations.createDeal.isPending}
            />
          </div>
        )}
        {relatedDeals.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('detail.noRelated')}</p>
        ) : (
          <div className="space-y-2">
            {relatedDeals.map((deal) => (
              <RelatedRow
                key={deal.id}
                href={`/${locale}/m/crm/deals/${deal.id}`}
                icon={Handshake}
                title={deal.title}
                meta={
                  <>
                    <Badge variant="secondary">{stageName(data.pipeline.data, deal.stageId, locale)}</Badge>
                    <span className="font-mono tabular-nums">
                      {formatMinorAmount(deal.value.amountMinor, deal.value.currency, { locale })}
                    </span>
                  </>
                }
              />
            ))}
          </div>
        )}
      </DetailCard>

      <DetailCard
        icon={History}
        title={t('detail.relatedActivities')}
        action={
          <Button variant="outline" size="sm" onClick={() => setShowNewActivity(!showNewActivity)}>
            {showNewActivity ? <X /> : <Plus />}
            {showNewActivity ? t('detail.cancel') : t('detail.newActivity')}
          </Button>
        }
      >
        {showNewActivity && (
          <div className="mb-4">
            <ActivityForm onSubmit={submitActivity} pending={mutations.createActivity.isPending} />
          </div>
        )}
        {relatedActivities.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('detail.noRelated')}</p>
        ) : (
          <div className="space-y-2">
            {relatedActivities.map((activity) => (
              <RelatedRow
                key={activity.id}
                href={`/${locale}/m/crm/activities/${activity.id}`}
                icon={History}
                title={`${t(`activities.types.${activity.type}`)} — ${activity.subject}`}
                meta={
                  <>
                    <DueBadge dueAt={activity.dueAt} completedAt={activity.completedAt} />
                    {activity.dueAt && <span>{formatDate(activity.dueAt, locale)}</span>}
                  </>
                }
              />
            ))}
          </div>
        )}
      </DetailCard>

      <NotesSection relatedType="contact" relatedId={id} />
    </div>
  );
}

// ─── Company detail ─────────────────────────────────────────────────────────

export function CompanyDetailView({ id }: { id: string }) {
  const t = useTranslations('modules.crm');
  const locale = useLocale();
  const company = useCrmCompanyDetail(id);
  const data = useCrmData();
  const mutations = useCrmMutations();
  const memberName = useMemberName();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Hoisted so every render calls the same hooks (rules-of-hooks).
  const c = company.data;
  const form = useForm<CompanyFormValues>({
    resolver: zodResolver(companyFormSchema),
    values: {
      name: c?.name ?? '',
      domain: c?.domain ?? '',
      industry: c?.industry ?? '',
      addressStreet: addressField(c?.address, 'street') ?? '',
      addressCity: addressField(c?.address, 'city') ?? '',
      addressState: addressField(c?.address, 'state') ?? '',
      addressPostalCode: addressField(c?.address, 'postalCode') ?? '',
      addressCountry: addressField(c?.address, 'country') ?? '',
    },
  });

  if (company.isPending)
    return <p className="py-10 text-center text-sm text-muted-foreground">{t('common.loading')}</p>;
  if (company.isError || !c) return <p className="py-10 text-center text-sm text-destructive">{t('errors.unknown')}</p>;
  const relatedContacts = data.contacts.data?.items.filter((contact) => contact.companyId === id) ?? [];
  const relatedDeals = data.deals.data?.items.filter((deal) => deal.companyId === id) ?? [];
  const addressEntries = c.address ? Object.entries(c.address).filter(([, v]) => v !== null && v !== '') : [];

  const submitEdit = (values: CompanyFormValues) =>
    mutations.updateCompany
      .mutateAsync({
        id,
        input: {
          name: values.name,
          domain: values.domain || null,
          industry: values.industry || null,
          address: {
            street: values.addressStreet || null,
            city: values.addressCity || null,
            state: values.addressState || null,
            postalCode: values.addressPostalCode || null,
            country: values.addressCountry || null,
          },
        },
      })
      .then(() => {
        setEditing(false);
        setError(null);
      })
      .catch((err: unknown) => setError(t(crmErrorKey(err))));

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/${locale}/m/crm/companies`}>
            <ArrowLeft className="rtl:rotate-180" />
            {t('detail.back')}
          </Link>
        </Button>
        <h1 className="text-xl font-semibold" dir="auto">
          {c.name}
        </h1>
      </div>

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      <DetailCard
        icon={Building2}
        title={t('detail.companyDetails')}
        action={
          !editing && (
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              <Pencil />
              {t('detail.edit')}
            </Button>
          )
        }
      >
        {editing ? (
          <form className="grid gap-4" onSubmit={(event) => void form.handleSubmit(submitEdit)(event)}>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label>{t('fields.name')}</Label>
                <Input dir="auto" {...form.register('name')} />
              </div>
              <div className="space-y-2">
                <Label>{t('fields.domain')}</Label>
                <Input {...form.register('domain')} />
              </div>
              <div className="space-y-2">
                <Label>{t('fields.industry')}</Label>
                <Input dir="auto" {...form.register('industry')} />
              </div>
            </div>
            <fieldset className="rounded-lg border p-4">
              <legend className="text-sm font-medium text-muted-foreground">{t('fields.address')}</legend>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>{t('fields.addressStreet')}</Label>
                  <Input dir="auto" {...form.register('addressStreet')} />
                </div>
                <div className="space-y-2">
                  <Label>{t('fields.addressCity')}</Label>
                  <Input dir="auto" {...form.register('addressCity')} />
                </div>
                <div className="space-y-2">
                  <Label>{t('fields.addressState')}</Label>
                  <Input dir="auto" {...form.register('addressState')} />
                </div>
                <div className="space-y-2">
                  <Label>{t('fields.addressPostalCode')}</Label>
                  <Input {...form.register('addressPostalCode')} />
                </div>
                <div className="space-y-2">
                  <Label>{t('fields.addressCountry')}</Label>
                  <Input dir="auto" {...form.register('addressCountry')} />
                </div>
              </div>
            </fieldset>
            <div className="flex gap-2">
              <Button loading={mutations.updateCompany.isPending}>{t('detail.save')}</Button>
              <Button variant="ghost" type="button" onClick={() => setEditing(false)}>
                {t('detail.cancel')}
              </Button>
            </div>
          </form>
        ) : (
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <DetailField label={t('fields.domain')} value={c.domain ?? '—'} />
            <DetailField label={t('fields.industry')} value={c.industry ?? '—'} />
            <DetailField label={t('detail.created')} value={formatDate(c.createdAt, locale)} />
            <DetailField label={t('detail.updated')} value={formatDate(c.updatedAt, locale)} />
            <DetailField label={t('detail.createdBy')} value={memberName(c.createdByUserId) ?? '—'} />
            <DetailField label={t('detail.updatedBy')} value={memberName(c.updatedByUserId) ?? '—'} />
          </dl>
        )}
      </DetailCard>

      <DetailCard icon={MapPin} title={t('detail.address')}>
        {addressEntries.length === 0 ? (
          <p className="text-sm text-muted-foreground">—</p>
        ) : (
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {addressEntries.map(([key, value]) => (
              <DetailField key={key} label={key} value={String(value)} />
            ))}
          </dl>
        )}
      </DetailCard>

      <DetailCard icon={Users} title={t('detail.relatedContacts')}>
        {relatedContacts.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('detail.noRelated')}</p>
        ) : (
          <div className="space-y-2">
            {relatedContacts.map((contact) => {
              const contactMeta = contact.email ?? contact.phone;
              return (
                <RelatedRow
                  key={contact.id}
                  href={`/${locale}/m/crm/contacts/${contact.id}`}
                  icon={Users}
                  title={`${contact.firstName} ${contact.lastName}`}
                  {...(contactMeta ? { meta: contactMeta } : {})}
                />
              );
            })}
          </div>
        )}
      </DetailCard>

      <DetailCard icon={Handshake} title={t('detail.relatedDeals')}>
        {relatedDeals.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('detail.noRelated')}</p>
        ) : (
          <div className="space-y-2">
            {relatedDeals.map((deal) => (
              <RelatedRow
                key={deal.id}
                href={`/${locale}/m/crm/deals/${deal.id}`}
                icon={Handshake}
                title={deal.title}
                meta={
                  <>
                    <Badge variant="secondary">{stageName(data.pipeline.data, deal.stageId, locale)}</Badge>
                    <span className="font-mono tabular-nums">
                      {formatMinorAmount(deal.value.amountMinor, deal.value.currency, { locale })}
                    </span>
                  </>
                }
              />
            ))}
          </div>
        )}
      </DetailCard>

      <NotesSection relatedType="company" relatedId={id} />
    </div>
  );
}

// ─── Deal detail ────────────────────────────────────────────────────────────

export function DealDetailView({ id }: { id: string }) {
  const t = useTranslations('modules.crm');
  const locale = useLocale();
  const deal = useCrmDealDetail(id);
  const data = useCrmData();
  const pipeline = data.pipeline;
  const mutations = useCrmMutations();
  const { data: currencies } = useCurrencies();
  const memberName = useMemberName();
  const [showNewActivity, setShowNewActivity] = useState(false);
  const [pendingMove, setPendingMove] = useState<{
    toStage: { id: string; nameI18n: Record<string, string>; isLost: boolean };
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (deal.isPending || pipeline.isPending)
    return <p className="py-10 text-center text-sm text-muted-foreground">{t('common.loading')}</p>;
  if (deal.isError || !deal.data || !pipeline.data)
    return <p className="py-10 text-center text-sm text-destructive">{t('errors.unknown')}</p>;
  const d = deal.data;
  const exponent = currencies?.find((c) => c.code === d.value.currency)?.exponent;
  const contact = data.contacts.data?.items.find((item) => item.id === d.contactId);
  const company = data.companies.data?.items.find((item) => item.id === d.companyId);
  const relatedActivities =
    data.activities.data?.items.filter((a) => a.relatedType === 'deal' && a.relatedId === id) ?? [];

  const submitActivity = (values: ActivityFormValues) =>
    mutations.createActivity
      .mutateAsync({
        type: values.type,
        subject: values.subject,
        dueAt: values.dueAt ? new Date(values.dueAt).toISOString() : null,
        relatedType: 'deal',
        relatedId: id,
      })
      .then(() => {
        setShowNewActivity(false);
        setError(null);
      })
      .catch((err: unknown) => setError(t(crmErrorKey(err))));

  const statusLabels: Record<string, string> = {
    open: 'detail.statusOpen',
    won: 'detail.statusWon',
    lost: 'detail.statusLost',
  };
  const statusKey = statusLabels[d.status] ?? 'detail.statusOpen';

  const requestMove = (toStage: { id: string; nameI18n: Record<string, string>; isLost: boolean }) => {
    if (toStage.id === d.stageId) return;
    if (toStage.isLost) setPendingMove({ toStage });
    else
      mutations.moveDeal
        .mutateAsync({ dealId: id, stageId: toStage.id })
        .then(() => setError(null))
        .catch((err: unknown) => setError(t(crmErrorKey(err))));
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/${locale}/m/crm/deals`}>
            <ArrowLeft className="rtl:rotate-180" />
            {t('detail.back')}
          </Link>
        </Button>
        <h1 className="text-xl font-semibold" dir="auto">
          {d.title}
        </h1>
      </div>

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      <DetailCard icon={Handshake} title={t('detail.dealDetails')}>
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <DetailField
            label={t('detail.value')}
            value={
              <span className="font-mono tabular-nums">
                {formatMinorAmount(d.value.amountMinor, d.value.currency, {
                  locale,
                  ...(exponent !== undefined ? { exponent } : {}),
                })}
              </span>
            }
          />
          <DetailField
            label={t('detail.stage')}
            value={
              <Can permission="crm:deal:write">
                <Select
                  aria-label={t('deals.move')}
                  value={d.stageId}
                  onValueChange={(value) => {
                    const stage = pipeline.data?.stages.find((s) => s.id === value);
                    if (stage) requestMove(stage);
                  }}
                >
                  {pipeline.data.stages.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.nameI18n[locale] ?? s.nameI18n.en}
                    </SelectItem>
                  ))}
                </Select>
              </Can>
            }
          />
          <DetailField
            label={t('detail.status')}
            value={
              <Badge variant={d.status === 'won' ? 'default' : d.status === 'lost' ? 'destructive' : 'secondary'}>
                {t(statusKey)}
              </Badge>
            }
          />
          <DetailField
            label={t('fields.contact')}
            value={
              contact ? (
                <Link
                  href={`/${locale}/m/crm/contacts/${contact.id}`}
                  className="text-primary underline-offset-4 hover:underline"
                >
                  {contact.firstName} {contact.lastName}
                </Link>
              ) : (
                '—'
              )
            }
          />
          <DetailField
            label={t('fields.company')}
            value={
              company ? (
                <Link
                  href={`/${locale}/m/crm/companies/${company.id}`}
                  className="text-primary underline-offset-4 hover:underline"
                >
                  {company.name}
                </Link>
              ) : (
                '—'
              )
            }
          />
          <DetailField label={t('detail.expectedClose')} value={formatDate(d.expectedCloseDate, locale)} />
          <DetailField label={t('detail.closed')} value={formatDate(d.closedAt, locale)} />
          <DetailField label={t('detail.lostReason')} value={d.lostReasonCode ?? '—'} />
          <DetailField label={t('detail.created')} value={formatDate(d.createdAt, locale)} />
          <DetailField label={t('detail.createdBy')} value={memberName(d.createdByUserId) ?? '—'} />
          <DetailField label={t('detail.updatedBy')} value={memberName(d.updatedByUserId) ?? '—'} />
        </dl>
      </DetailCard>

      <MoveDealDialog
        open={pendingMove !== null}
        dealTitle={d.title}
        toStageName={pendingMove ? stageName(pipeline.data, pendingMove.toStage.id, locale) : ''}
        requiresReason={pendingMove?.toStage.isLost ?? false}
        pending={mutations.moveDeal.isPending}
        onConfirm={(reason) => {
          if (!pendingMove) return;
          mutations.moveDeal
            .mutateAsync({ dealId: id, stageId: pendingMove.toStage.id, ...(reason ? { lostReasonCode: reason } : {}) })
            .then(() => {
              setPendingMove(null);
              setError(null);
            })
            .catch((err: unknown) => {
              setPendingMove(null);
              setError(t(crmErrorKey(err)));
            });
        }}
        onCancel={() => {
          if (!mutations.moveDeal.isPending) setPendingMove(null);
        }}
      />

      <DetailCard icon={History} title={t('detail.stageHistory')}>
        {d.stageHistory.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('detail.noHistory')}</p>
        ) : (
          <ol className="space-y-3">
            {d.stageHistory.map((entry) => (
              <li key={entry.id} className="flex items-start gap-3 text-sm">
                <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" aria-hidden="true" />
                <div className="min-w-0">
                  <p>
                    {stageName(pipeline.data, entry.fromStageId, locale)}{' '}
                    <span className="text-muted-foreground">→</span> {stageName(pipeline.data, entry.toStageId, locale)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(entry.movedAt, locale)} · {formatDuration(entry.durationSeconds)} ·{' '}
                    {t('detail.movedBy', { name: memberName(entry.movedBy) ?? t('common.system') })}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </DetailCard>

      <DetailCard
        icon={History}
        title={t('detail.relatedActivities')}
        action={
          <Button variant="outline" size="sm" onClick={() => setShowNewActivity(!showNewActivity)}>
            {showNewActivity ? <X /> : <Plus />}
            {showNewActivity ? t('detail.cancel') : t('detail.newActivity')}
          </Button>
        }
      >
        {showNewActivity && (
          <div className="mb-4">
            <ActivityForm onSubmit={submitActivity} pending={mutations.createActivity.isPending} />
          </div>
        )}
        {relatedActivities.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('detail.noRelated')}</p>
        ) : (
          <div className="space-y-2">
            {relatedActivities.map((activity) => (
              <RelatedRow
                key={activity.id}
                href={`/${locale}/m/crm/activities/${activity.id}`}
                icon={History}
                title={`${t(`activities.types.${activity.type}`)} — ${activity.subject}`}
                meta={
                  <>
                    <DueBadge dueAt={activity.dueAt} completedAt={activity.completedAt} />
                    {activity.dueAt && <span>{formatDate(activity.dueAt, locale)}</span>}
                  </>
                }
              />
            ))}
          </div>
        )}
      </DetailCard>

      <NotesSection relatedType="deal" relatedId={id} />
    </div>
  );
}

// ─── Activity detail ────────────────────────────────────────────────────────

/** Activity type values — mirrors `CrmActivity['type']` and the API enum. */
type ActivityTypeValue = 'call' | 'meeting' | 'task' | 'email';
// A readonly typed array avoids an `as const` cast (no-restricted-syntax).
const ACTIVITY_TYPES: readonly ActivityTypeValue[] = ['call', 'meeting', 'task', 'email'];
const isActivityType = (value: string): value is ActivityTypeValue => ACTIVITY_TYPES.some((type) => type === value);

export function ActivityDetailView({ id }: { id: string }) {
  const t = useTranslations('modules.crm');
  const locale = useLocale();
  const activity = useCrmActivityDetail(id);
  const data = useCrmData();
  const mutations = useCrmMutations();
  const memberName = useMemberName();
  const [dueValue, setDueValue] = useState('');
  const [editing, setEditing] = useState(false);
  const [editSubject, setEditSubject] = useState('');
  const [editType, setEditType] = useState<ActivityTypeValue>('task');
  const [editAssignee, setEditAssignee] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data: members } = useOrgMembers();
  // Display names resolve from ALL members (a removed member still shows their
  // name on activities they were assigned to); only active members are offered
  // in the reassign select (CRM-14).
  const allMembers = members ?? [];
  const assigneeName = (userId: string | null) => {
    const member = allMembers.find((m) => m.userId === userId);
    if (!member) return null;
    return member.name || member.email;
  };
  const activeMembers = allMembers.filter((m) => m.status === 'active');

  const a = activity.data;

  if (activity.isPending)
    return <p className="py-10 text-center text-sm text-muted-foreground">{t('common.loading')}</p>;
  if (activity.isError || !a)
    return <p className="py-10 text-center text-sm text-destructive">{t('errors.unknown')}</p>;

  // Resolve the related entity (contact / company / deal) into a deep link.
  let relatedHref: string | null = null;
  let relatedName: string | null = null;
  if (a.relatedType === 'contact' && a.relatedId) {
    const contact = data.contacts.data?.items.find((item) => item.id === a.relatedId);
    relatedHref = `/${locale}/m/crm/contacts/${a.relatedId}`;
    relatedName = contact ? `${contact.firstName} ${contact.lastName}` : null;
  } else if (a.relatedType === 'company' && a.relatedId) {
    const company = data.companies.data?.items.find((item) => item.id === a.relatedId);
    relatedHref = `/${locale}/m/crm/companies/${a.relatedId}`;
    relatedName = company?.name ?? null;
  } else if (a.relatedType === 'deal' && a.relatedId) {
    const deal = data.deals.data?.items.find((item) => item.id === a.relatedId);
    relatedHref = `/${locale}/m/crm/deals/${a.relatedId}`;
    relatedName = deal?.title ?? null;
  }

  const completed = a.completedAt !== null;

  const startEdit = () => {
    setEditSubject(a.subject);
    setEditType(a.type);
    setEditAssignee(a.assignedToUserId ?? '');
    setEditing(true);
  };

  const submitEdit = () => {
    const input: { subject?: string; type?: ActivityTypeValue; assignedToUserId?: string | null } = {};
    if (editSubject.trim() !== a.subject) input.subject = editSubject.trim();
    if (editType !== a.type) input.type = editType;
    // '' = unassign (CRM-14 allows unassigning; only send on a real change).
    if (editAssignee !== (a.assignedToUserId ?? '')) input.assignedToUserId = editAssignee || null;
    mutations.updateActivity
      .mutateAsync({ id, input })
      .then(() => {
        setEditing(false);
        setError(null);
      })
      .catch((err: unknown) => setError(t(crmErrorKey(err))));
  };

  const submitDueDate = () => {
    if (!dueValue) return;
    mutations.updateActivity
      .mutateAsync({ id, input: { dueAt: new Date(dueValue).toISOString() } })
      .then(() => {
        setDueValue('');
        setError(null);
      })
      .catch((err: unknown) => setError(t(crmErrorKey(err))));
  };

  // The current assignee stays selectable even if no longer an active member,
  // so the select always shows the real value.
  const assigneeOptions =
    a.assignedToUserId && !activeMembers.some((m) => m.userId === a.assignedToUserId)
      ? [{ userId: a.assignedToUserId, name: assigneeName(a.assignedToUserId) ?? a.assignedToUserId }, ...activeMembers]
      : activeMembers;

  const complete = () => {
    mutations.completeActivity
      .mutateAsync(id)
      .then(() => setError(null))
      .catch((err: unknown) => setError(t(crmErrorKey(err))));
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/${locale}/m/crm/activities`}>
            <ArrowLeft className="rtl:rotate-180" />
            {t('detail.back')}
          </Link>
        </Button>
        <h1 className="text-xl font-semibold" dir="auto">
          {a.subject}
        </h1>
        <Badge variant="outline">{t(`activities.types.${a.type}`)}</Badge>
      </div>

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      <DetailCard
        icon={History}
        title={t('detail.activityDetails')}
        action={
          !completed &&
          !editing && (
            <Can permission="crm:activity:write">
              <Button variant="outline" size="sm" onClick={startEdit}>
                <Pencil />
                {t('detail.edit')}
              </Button>
            </Can>
          )
        }
      >
        {editing ? (
          <form
            className="grid gap-4 md:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              submitEdit();
            }}
          >
            <div className="space-y-2">
              <Label>{t('fields.type')}</Label>
              <Select
                value={editType}
                onValueChange={(value) => {
                  if (isActivityType(value)) setEditType(value);
                }}
              >
                <SelectItem value="call">{t('activities.types.call')}</SelectItem>
                <SelectItem value="meeting">{t('activities.types.meeting')}</SelectItem>
                <SelectItem value="task">{t('activities.types.task')}</SelectItem>
                <SelectItem value="email">{t('activities.types.email')}</SelectItem>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t('fields.subject')}</Label>
              <Input dir="auto" value={editSubject} onChange={(event) => setEditSubject(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>{t('fields.assignee')}</Label>
              {/* CRM-14: only active members may hold assignments; the current
                  assignee stays selectable even if they've since left the org. */}
              <Select value={editAssignee} onValueChange={setEditAssignee} aria-label={t('fields.assignee')}>
                <SelectItem value="">{t('common.none')}</SelectItem>
                {assigneeOptions.map((member) => (
                  <SelectItem key={member.userId} value={member.userId}>
                    {member.name}
                  </SelectItem>
                ))}
              </Select>
            </div>
            <div className="flex gap-2 md:col-span-2">
              <Button
                loading={mutations.updateActivity.isPending}
                disabled={
                  !editSubject.trim() ||
                  (editSubject.trim() === a.subject &&
                    editType === a.type &&
                    editAssignee === (a.assignedToUserId ?? ''))
                }
              >
                {t('detail.save')}
              </Button>
              <Button variant="ghost" type="button" onClick={() => setEditing(false)}>
                {t('detail.cancel')}
              </Button>
            </div>
          </form>
        ) : (
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <DetailField
              label={t('fields.type')}
              value={<Badge variant="outline">{t(`activities.types.${a.type}`)}</Badge>}
            />
            <DetailField label={t('detail.status')} value={<DueBadge dueAt={a.dueAt} completedAt={a.completedAt} />} />
            <DetailField label={t('fields.assignee')} value={assigneeName(a.assignedToUserId) ?? '—'} />
            <DetailField label={t('fields.dueAt')} value={formatDate(a.dueAt, locale)} />
            <DetailField label={t('detail.completedAt')} value={formatDate(a.completedAt, locale)} />
            <DetailField
              label={t('detail.relatedTo')}
              value={
                relatedHref ? (
                  <Link href={relatedHref} className="text-primary underline-offset-4 hover:underline" dir="auto">
                    {relatedName ?? a.relatedType}
                  </Link>
                ) : (
                  '—'
                )
              }
            />
            <DetailField label={t('detail.created')} value={formatDate(a.createdAt, locale)} />
            <DetailField label={t('detail.updated')} value={formatDate(a.updatedAt, locale)} />
            <DetailField label={t('detail.createdBy')} value={memberName(a.createdByUserId) ?? '—'} />
            <DetailField label={t('detail.updatedBy')} value={memberName(a.updatedByUserId) ?? '—'} />
          </dl>
        )}
      </DetailCard>

      {!completed ? (
        <DetailCard
          icon={CalendarClock}
          title={t('activities.extendDueDate')}
          action={
            <Can permission="crm:activity:write">
              <Button variant="outline" size="sm" onClick={complete} loading={mutations.completeActivity.isPending}>
                {t('activities.complete')}
              </Button>
            </Can>
          }
        >
          <div className="flex flex-wrap gap-2">
            <Input
              type="datetime-local"
              value={dueValue}
              onChange={(event) => setDueValue(event.target.value)}
              className="max-w-xs"
            />
            <Can permission="crm:activity:write">
              <Button onClick={submitDueDate} loading={mutations.updateActivity.isPending} disabled={!dueValue}>
                {t('detail.save')}
              </Button>
            </Can>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{t('activities.dueDateHint')}</p>
        </DetailCard>
      ) : (
        <p className="text-sm text-muted-foreground">{t('activities.completedImmutable')}</p>
      )}

      <NotesSection relatedType="activity" relatedId={id} />
    </div>
  );
}
