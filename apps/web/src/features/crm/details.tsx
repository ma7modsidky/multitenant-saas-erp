'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQueries } from '@tanstack/react-query';
import {
  ArrowLeft,
  Building2,
  CalendarClock,
  Handshake,
  History,
  Mail,
  MessageSquare,
  Pencil,
  Phone,
  Plus,
  Send,
  Users,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';

import { cn } from '@/components/cn';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectItem } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { locales } from '@/i18n/routing';
import { getCrmDeal, type CrmDealDetail } from '@/lib/api/resources';
import { Can } from '@/lib/permissions';

import { DueBadge } from './due-badge';
import { crmErrorKey } from './errors';
import { DealForm } from './forms';
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
  useTeams,
} from './hooks';
import { formatMinorAmount } from './money';
import { MoveDealDialog } from './move-deal-dialog';
import {
  companyFormSchema,
  contactFormSchema,
  type CompanyFormValues,
  type ContactFormValues,
  type DealFormValues,
} from './schemas';
import {
  activityTone,
  buildCrmTimeline,
  groupTimelineByDate,
  TIMELINE_DEAL_LIMIT,
  TIMELINE_PAGE_SIZE,
  type CrmTimelineEntry,
  type CrmTimelineGroupKind,
} from './timeline';

// ─── Display helpers ────────────────────────────────────────────────────────

function formatDate(iso: string | null | undefined, locale: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
}

function formatEpoch(at: number, locale: string): string {
  return formatDate(new Date(at).toISOString(), locale);
}

/** Read a string field off the company address record (unknown values → null). */
function addressField(address: Record<string, unknown> | undefined, key: string): string | null {
  const value = address?.[key];
  return typeof value === 'string' ? value : null;
}

/** One-line postal address from the company address record (empty parts skipped). */
function addressLine(address: Record<string, unknown> | undefined): string {
  return ['street', 'city', 'state', 'postalCode', 'country']
    .map((key) => addressField(address, key))
    .filter((part): part is string => part !== null)
    .join(', ');
}

/** Activity type values — mirrors `CrmActivity['type']` and the API enum. */
type ActivityTypeValue = 'call' | 'meeting' | 'task' | 'email';
const ACTIVITY_TYPES: readonly ActivityTypeValue[] = ['call', 'meeting', 'task', 'email'];
const isActivityType = (value: string): value is ActivityTypeValue => ACTIVITY_TYPES.some((type) => type === value);

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

/** Won / lost / open tone for a pipeline stage (drives timeline status pills). */
type DealStatusTone = 'open' | 'won' | 'lost';

function pipelineStageStatus(
  pipeline: { stages: Array<{ id: string; isWon: boolean; isLost: boolean }> } | null | undefined,
  stageId: string | null,
): DealStatusTone {
  const stage = pipeline?.stages.find((s) => s.id === stageId);
  if (!stage) return 'open';
  if (stage.isWon) return 'won';
  if (stage.isLost) return 'lost';
  return 'open';
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

function EmptyState({ icon: Icon, children }: { icon: typeof Users; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-10 text-center">
      <Icon className="size-6 text-muted-foreground" aria-hidden="true" />
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  );
}

// ─── Section tabs (contact detail) ─────────────────────────────────────────

/** Contact detail tabs — overview merges details, quick updates, and the
    activity timeline; deals stays as the linked-records tab. */
type ContactTab = 'overview' | 'deals';

/** Company detail tabs — same activity-centric split as contacts. */
type CompanyTab = 'overview' | 'contacts' | 'deals';

/** Deal detail tabs — a single overview that merges details, the quick
    composer, and the activity timeline (stage changes included via Timeline). */
type DealTab = 'overview';

function DetailTabs<T extends string>({
  idPrefix,
  tabs,
  value,
  onChange,
}: {
  idPrefix: string;
  tabs: Array<{ key: T; label: string; count?: number }>;
  value: T;
  onChange: (key: T) => void;
}) {
  const t = useTranslations('modules.crm');
  const handleKeyDown = (event: React.KeyboardEvent) => {
    const index = tabs.findIndex((tab) => tab.key === value);
    if (index < 0) return;
    // RTL flips the visual order, so the arrow directions swap meaning.
    const rtl = typeof document !== 'undefined' && document.documentElement.dir === 'rtl';
    const step = rtl ? -1 : 1;
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      const next = tabs[(index + step + tabs.length) % tabs.length];
      if (next) onChange(next.key);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      const prev = tabs[(index - step + tabs.length) % tabs.length];
      if (prev) onChange(prev.key);
    } else if (event.key === 'Home') {
      event.preventDefault();
      const first = tabs[0];
      if (first) onChange(first.key);
    } else if (event.key === 'End') {
      event.preventDefault();
      const last = tabs[tabs.length - 1];
      if (last) onChange(last.key);
    }
  };
  return (
    <div
      role="tablist"
      aria-label={t('detail.sections')}
      onKeyDown={handleKeyDown}
      className="flex flex-wrap gap-1 rounded-lg border bg-muted/40 p-1"
    >
      {tabs.map((tab) => {
        const active = tab.key === value;
        return (
          <button
            key={tab.key}
            id={`${idPrefix}-tab-${tab.key}`}
            type="button"
            role="tab"
            aria-selected={active}
            aria-controls={`${idPrefix}-panel`}
            onClick={() => onChange(tab.key)}
            className={cn(
              'inline-flex h-8 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
              active
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            {tab.label}
            {tab.count !== undefined && tab.count > 0 && (
              <Badge variant={active ? 'secondary' : 'outline'} className="tabular-nums">
                {tab.count}
              </Badge>
            )}
          </button>
        );
      })}
    </div>
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

// ─── Overview: quick-update composer + activity timeline ───────────────────

/** Inline composer for the Overview tab: one text area that either saves a
    note or logs an activity (type + optional due date) without a modal. */
export function QuickUpdateComposer({
  relatedType,
  relatedId,
}: {
  relatedType: 'contact' | 'company' | 'deal';
  relatedId: string;
}) {
  const t = useTranslations('modules.crm');
  const mutations = useCrmMutations();
  const [body, setBody] = useState('');
  const [logActivity, setLogActivity] = useState(false);
  const [type, setType] = useState<ActivityTypeValue>('call');
  const [dueAt, setDueAt] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submitNote = () => {
    if (!body.trim()) return;
    mutations.createNote.mutate(
      { body: body.trim(), relatedType, relatedId },
      {
        onSuccess: () => {
          setBody('');
          setError(null);
        },
        onError: (err: unknown) => setError(t(crmErrorKey(err))),
      },
    );
  };

  const submitActivity = () => {
    if (!body.trim()) return;
    mutations.createActivity.mutate(
      {
        type,
        subject: body.trim(),
        ...(dueAt ? { dueAt: new Date(dueAt).toISOString() } : {}),
        relatedType,
        relatedId,
      },
      {
        onSuccess: () => {
          setBody('');
          setDueAt('');
          setLogActivity(false);
          setError(null);
        },
        onError: (err: unknown) => setError(t(crmErrorKey(err))),
      },
    );
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div className="flex items-center gap-2">
          <MessageSquare className="size-4 text-muted-foreground" />
          <CardTitle className="text-base">{t('detail.quickUpdate')}</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder={t('notes.placeholder')}
          rows={3}
          dir="auto"
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              if (logActivity) submitActivity();
              else submitNote();
            }
          }}
        />
        {logActivity && (
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={type}
              onValueChange={(value) => {
                if (isActivityType(value)) setType(value);
              }}
              className="w-44"
              aria-label={t('fields.type')}
            >
              <SelectItem value="call">{t('activities.types.call')}</SelectItem>
              <SelectItem value="meeting">{t('activities.types.meeting')}</SelectItem>
              <SelectItem value="task">{t('activities.types.task')}</SelectItem>
              <SelectItem value="email">{t('activities.types.email')}</SelectItem>
            </Select>
            <Input
              type="datetime-local"
              value={dueAt}
              onChange={(event) => setDueAt(event.target.value)}
              aria-label={t('fields.dueAt')}
              className="max-w-xs"
            />
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button variant="outline" size="sm" onClick={() => setLogActivity(!logActivity)}>
            {logActivity ? <X /> : <CalendarClock />}
            {logActivity ? t('common.cancel') : t('notes.logActivity')}
          </Button>
          {logActivity ? (
            <Button
              size="sm"
              onClick={submitActivity}
              loading={mutations.createActivity.isPending}
              disabled={!body.trim()}
            >
              <Send />
              {t('notes.logActivity')}
            </Button>
          ) : (
            <Button size="sm" onClick={submitNote} loading={mutations.createNote.isPending} disabled={!body.trim()}>
              <Send />
              {t('notes.add')}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

type TileTone = 'neutral' | 'deal' | 'note' | 'good' | 'bad';

const TILE_TONES: Record<TileTone, string> = {
  neutral: 'border-border bg-muted/40 text-muted-foreground',
  deal: 'border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400',
  note: 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400',
  good: 'border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400',
  bad: 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400',
};

const STATUS_PILL_TONES: Record<DealStatusTone, string> = {
  won: 'border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-400',
  lost: 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400',
  open: 'border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-400',
};

function StatusPill({ status }: { status: DealStatusTone }) {
  const t = useTranslations('modules.crm');
  const label =
    status === 'won' ? t('detail.statusWon') : status === 'lost' ? t('detail.statusLost') : t('detail.statusOpen');
  return (
    <Badge variant="outline" className={STATUS_PILL_TONES[status]}>
      {label}
    </Badge>
  );
}

function TimelineTile({ icon: Icon, tone }: { icon: typeof Users; tone: TileTone }) {
  return (
    <span
      className={cn(
        'absolute -start-10 top-0 flex size-8 items-center justify-center rounded-full border shadow-sm',
        TILE_TONES[tone],
      )}
    >
      <Icon className="size-4" aria-hidden="true" />
    </span>
  );
}

function TimelineMeta({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">{children}</p>;
}

const ACTIVITY_TYPE_ICONS: Record<ActivityTypeValue, typeof Users> = {
  call: Phone,
  meeting: Users,
  task: History,
  email: Mail,
};

export interface TimelineContext {
  resolveMember: (userId: string | null) => string | null;
  stageLabel: (stageId: string | null) => string;
  stageStatus: (stageId: string | null) => DealStatusTone;
  recordIcon: typeof Users;
}

function timelineIcon(entry: CrmTimelineEntry, recordIcon: typeof Users): typeof Users {
  if (entry.kind === 'note') return MessageSquare;
  if (entry.kind === 'activity') return ACTIVITY_TYPE_ICONS[entry.activity.type];
  if (entry.kind === 'deal-created') return Handshake;
  if (entry.kind === 'stage-changed') return History;
  if (entry.kind === 'record-created') return recordIcon;
  return Pencil;
}

function timelineTone(entry: CrmTimelineEntry): TileTone {
  if (entry.kind === 'note') return 'note';
  if (entry.kind === 'deal-created' || entry.kind === 'stage-changed') return 'deal';
  if (entry.kind === 'activity') {
    const tone = activityTone(entry.activity);
    return tone === 'completed' ? 'good' : tone === 'overdue' ? 'bad' : 'neutral';
  }
  return 'neutral';
}

function TimelineNote({ entry, ctx }: { entry: Extract<CrmTimelineEntry, { kind: 'note' }>; ctx: TimelineContext }) {
  const t = useTranslations('modules.crm');
  const locale = useLocale();
  return (
    <>
      <p className="whitespace-pre-wrap text-sm" dir="auto">
        {entry.note.body}
      </p>
      <TimelineMeta>
        {ctx.resolveMember(entry.note.createdByUserId) ?? t('common.system')} ·{' '}
        {formatDate(entry.note.createdAt, locale)}
      </TimelineMeta>
    </>
  );
}

function TimelineActivity({ entry }: { entry: Extract<CrmTimelineEntry, { kind: 'activity' }> }) {
  const t = useTranslations('modules.crm');
  const locale = useLocale();
  return (
    <>
      <Link
        href={`/${locale}/m/crm/activities/${entry.activity.id}`}
        className="text-sm underline-offset-4 hover:underline"
        dir="auto"
      >
        {t(`activities.types.${entry.activity.type}`)} — {entry.activity.subject}
      </Link>
      <TimelineMeta>
        <DueBadge dueAt={entry.activity.dueAt} completedAt={entry.activity.completedAt} />
        {entry.activity.dueAt && <span>{formatDate(entry.activity.dueAt, locale)}</span>}
      </TimelineMeta>
    </>
  );
}

function TimelineDealCreated({
  entry,
  ctx,
}: {
  entry: Extract<CrmTimelineEntry, { kind: 'deal-created' }>;
  ctx: TimelineContext;
}) {
  const locale = useLocale();
  return (
    <>
      <p className="flex flex-wrap items-center gap-2">
        <Link
          href={`/${locale}/m/crm/deals/${entry.deal.id}`}
          className="text-sm font-semibold underline-offset-4 hover:underline"
          dir="auto"
        >
          {entry.deal.title}
        </Link>
        <StatusPill status={entry.deal.status} />
      </p>
      <TimelineMeta>
        <span className="font-mono text-sm font-medium tabular-nums text-foreground">
          {formatMinorAmount(entry.deal.value.amountMinor, entry.deal.value.currency, { locale })}
        </span>
        <Badge variant="secondary">{ctx.stageLabel(entry.deal.stageId)}</Badge>
        <span>{formatEpoch(entry.at, locale)}</span>
      </TimelineMeta>
    </>
  );
}

function TimelineStageChanged({
  entry,
  ctx,
}: {
  entry: Extract<CrmTimelineEntry, { kind: 'stage-changed' }>;
  ctx: TimelineContext;
}) {
  const t = useTranslations('modules.crm');
  const locale = useLocale();
  const deal = entry.deal;
  return (
    <>
      <p className="flex flex-wrap items-center gap-2 text-sm">
        <Handshake className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="text-muted-foreground">{t('detail.timeline.stageMoved')}:</span>
        <Link
          href={`/${locale}/m/crm/deals/${deal.id}`}
          className="text-sm font-semibold underline-offset-4 hover:underline"
          dir="auto"
        >
          {deal.title}
        </Link>
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <Badge variant="secondary">
          {ctx.stageLabel(entry.entry.fromStageId)} <span className="text-muted-foreground">→</span>{' '}
          {ctx.stageLabel(entry.entry.toStageId)}
        </Badge>
        <span className="font-mono font-medium tabular-nums text-foreground">
          {formatMinorAmount(deal.value.amountMinor, deal.value.currency, { locale })}
        </span>
      </div>
      <TimelineMeta>
        <span>{formatEpoch(entry.at, locale)}</span>
        <span aria-hidden="true">·</span>
        <span>{t('detail.movedBy', { name: ctx.resolveMember(entry.entry.movedBy) ?? t('common.system') })}</span>
      </TimelineMeta>
    </>
  );
}

function TimelineRecordEvent({
  entry,
  ctx,
}: {
  entry: Extract<CrmTimelineEntry, { kind: 'record-created' | 'record-edited' }>;
  ctx: TimelineContext;
}) {
  const t = useTranslations('modules.crm');
  const locale = useLocale();
  return (
    <>
      <p className="text-sm">
        {entry.kind === 'record-created' ? t('detail.timeline.recordCreated') : t('detail.timeline.recordEdited')}
      </p>
      <TimelineMeta>
        {formatEpoch(entry.at, locale)} · {ctx.resolveMember(entry.userId) ?? t('common.system')}
      </TimelineMeta>
    </>
  );
}

export function ActivityTimelineFeed({
  entries,
  resolveMember,
  stageLabel,
  stageStatus,
  recordIcon,
}: TimelineContext & { entries: CrmTimelineEntry[] }) {
  const t = useTranslations('modules.crm');
  const locale = useLocale();
  const [visibleCount, setVisibleCount] = useState(TIMELINE_PAGE_SIZE);

  if (entries.length === 0) return <EmptyState icon={History}>{t('detail.timeline.empty')}</EmptyState>;

  const ctx: TimelineContext = { resolveMember, stageLabel, stageStatus, recordIcon };
  const groups = groupTimelineByDate(entries.slice(0, visibleCount), locale);

  const groupLabel = (kind: CrmTimelineGroupKind, label: string): string => {
    if (kind === 'today') return t('detail.timeline.today');
    if (kind === 'yesterday') return t('detail.timeline.yesterday');
    if (kind === 'this-month') return t('detail.timeline.thisMonth');
    if (kind === 'earlier') return t('detail.timeline.earlier');
    return label;
  };

  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <section key={group.key}>
          <h3 className="sticky top-14 z-20 -mx-1 bg-background/95 px-1 py-0.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur-sm">
            {groupLabel(group.kind, group.label)}
          </h3>
          <ol className="relative mt-3 space-y-6 border-s ps-6">
            {group.entries.map((entry) => (
              <li key={entry.id} className="relative">
                <TimelineTile icon={timelineIcon(entry, recordIcon)} tone={timelineTone(entry)} />
                <div className="min-w-0 pt-1">
                  {entry.kind === 'note' && <TimelineNote entry={entry} ctx={ctx} />}
                  {entry.kind === 'activity' && <TimelineActivity entry={entry} />}
                  {entry.kind === 'deal-created' && <TimelineDealCreated entry={entry} ctx={ctx} />}
                  {entry.kind === 'stage-changed' && <TimelineStageChanged entry={entry} ctx={ctx} />}
                  {entry.kind !== 'note' &&
                    entry.kind !== 'activity' &&
                    entry.kind !== 'deal-created' &&
                    entry.kind !== 'stage-changed' && <TimelineRecordEvent entry={entry} ctx={ctx} />}
                </div>
              </li>
            ))}
          </ol>
        </section>
      ))}
      {entries.length > visibleCount && (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" onClick={() => setVisibleCount((count) => count + TIMELINE_PAGE_SIZE)}>
            {t('detail.timeline.loadMore')}
          </Button>
        </div>
      )}
    </div>
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
  const { data: teamsData } = useTeams();
  const { data: membersData } = useOrgMembers();
  const [editing, setEditing] = useState(false);
  const [showNewDeal, setShowNewDeal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<ContactTab>('overview');
  const notes = useCrmNotes('contact', id);
  // Deal details power the timeline's deal-created + stage-change events; the
  // queries share keys with the deal detail view, so navigation reuses cache.
  const relatedDealIds = useMemo(
    () => data.deals.data?.items.filter((deal) => deal.contactId === id).map((deal) => deal.id) ?? [],
    [data.deals.data, id],
  );
  const dealDetailResults = useQueries({
    queries: relatedDealIds.slice(0, TIMELINE_DEAL_LIMIT).map((dealId) => ({
      queryKey: ['crm', 'deals', dealId],
      queryFn: () => getCrmDeal(dealId),
    })),
  });
  // Back always returns to the contact list page — and to the exact list the
  // user left (cards/table + filters), falling back to the plain list when
  // they arrived from elsewhere (e.g. a related deal or activity).
  const [backHref, setBackHref] = useState<string | null>(null);
  useEffect(() => {
    const saved = window.sessionStorage.getItem('crm.contacts.back');
    if (saved && saved.startsWith(`/${locale}/m/crm/contacts`)) setBackHref(saved);
  }, [locale]);

  // Hoisted so every render calls the same hooks (rules-of-hooks). `values`
  // syncs the form once the record loads (deep-equal, so user edits survive).
  const c = contact.data;
  const cOwnerTeamId = c?.ownerTeamId ?? null;
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
      ownerUserId: c?.ownerUserId ?? '',
      ownerTeamId: cOwnerTeamId ?? '',
    },
  });

  if (contact.isPending)
    return <p className="py-10 text-center text-sm text-muted-foreground">{t('common.loading')}</p>;
  if (contact.isError || !c) return <p className="py-10 text-center text-sm text-destructive">{t('errors.unknown')}</p>;
  const companyName = data.companies.data?.items.find((item) => item.id === c.companyId)?.name;
  const relatedDeals = data.deals.data?.items.filter((deal) => deal.contactId === id) ?? [];
  const relatedActivities =
    data.activities.data?.items.filter((a) => a.relatedType === 'contact' && a.relatedId === id) ?? [];
  const dealDetails = dealDetailResults
    .map((result) => result.data)
    .filter((deal): deal is CrmDealDetail => deal !== undefined);
  const timeline = buildCrmTimeline({
    createdAt: c.createdAt,
    createdByUserId: c.createdByUserId,
    updatedAt: c.updatedAt,
    updatedByUserId: c.updatedByUserId,
    notes: notes.data?.items ?? [],
    activities: relatedActivities,
    deals: dealDetails,
  });

  const tabs: Array<{ key: ContactTab; label: string; count?: number }> = [
    { key: 'overview', label: t('detail.overviewTimeline'), count: timeline.length },
    { key: 'deals', label: t('detail.relatedDeals'), count: relatedDeals.length },
  ];

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
          ownerUserId: values.ownerUserId || null,
          ownerTeamId: values.ownerTeamId || null,
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

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href={backHref ?? `/${locale}/m/crm/contacts`}>
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

      <DetailTabs tabs={tabs} value={tab} onChange={setTab} idPrefix="contact" />

      <div role="tabpanel" id="contact-panel" aria-labelledby={`contact-tab-${tab}`} className="space-y-5">
        {tab === 'overview' && (
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
              <form
                className="grid gap-4 md:grid-cols-2"
                onSubmit={(event) => void form.handleSubmit(submitEdit)(event)}
              >
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
                  <Label>{t('fields.owner')}</Label>
                  <Select
                    value={form.watch('ownerUserId') ?? ''}
                    onValueChange={(v) => form.setValue('ownerUserId', v)}
                    {...form.register('ownerUserId')}
                  >
                    <SelectItem value="">{t('common.none')}</SelectItem>
                    {(membersData ?? [])
                      .filter((m) => m.status === 'active')
                      .map((m) => (
                        <SelectItem key={m.userId} value={m.userId}>
                          {m.name || m.email}
                        </SelectItem>
                      ))}
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{t('fields.ownerTeam')}</Label>
                  <Select
                    value={form.watch('ownerTeamId') ?? ''}
                    onValueChange={(v) => form.setValue('ownerTeamId', v)}
                    {...form.register('ownerTeamId')}
                  >
                    <SelectItem value="">{t('common.none')}</SelectItem>
                    {(teamsData ?? []).map((team: { id: string; name: string }) => (
                      <SelectItem key={team.id} value={team.id}>
                        {team.name}
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
                <DetailField
                  label={t('fields.company')}
                  value={
                    companyName ? (
                      <Link
                        href={`/${locale}/m/crm/companies/${c.companyId}`}
                        className="text-primary underline-offset-4 hover:underline"
                      >
                        {companyName}
                      </Link>
                    ) : (
                      '—'
                    )
                  }
                />
                <DetailField label={t('fields.owner')} value={memberName(c.ownerUserId) ?? '—'} />
                <DetailField
                  label={t('fields.ownerTeam')}
                  value={(() => {
                    const teamName = (teamsData ?? []).find((team) => team.id === cOwnerTeamId)?.name;
                    return teamName ?? '—';
                  })()}
                />
                <DetailField label={t('detail.preferredLocale')} value={c.preferredLocale ?? '—'} />
                <DetailField label={t('detail.preferredCurrency')} value={c.preferredCurrency ?? '—'} />
                <DetailField label={t('detail.created')} value={formatDate(c.createdAt, locale)} />
                <DetailField label={t('detail.updated')} value={formatDate(c.updatedAt, locale)} />
                <DetailField label={t('detail.createdBy')} value={memberName(c.createdByUserId) ?? '—'} />
                <DetailField label={t('detail.updatedBy')} value={memberName(c.updatedByUserId) ?? '—'} />
              </dl>
            )}
          </DetailCard>
        )}

        {tab === 'overview' && <QuickUpdateComposer relatedType="contact" relatedId={id} />}

        {tab === 'overview' && (
          <DetailCard icon={History} title={t('detail.timeline.title')}>
            <ActivityTimelineFeed
              entries={timeline}
              resolveMember={memberName}
              stageLabel={(stageId) => stageName(data.pipeline.data, stageId, locale)}
              stageStatus={(stageId) => pipelineStageStatus(data.pipeline.data, stageId)}
              recordIcon={Users}
            />
          </DetailCard>
        )}

        {tab === 'deals' && (
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
              <EmptyState icon={Handshake}>{t('detail.noRelated')}</EmptyState>
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
        )}
      </div>
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
  const { data: teamsData } = useTeams();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<CompanyTab>('overview');
  const notes = useCrmNotes('company', id);
  // Deal details power the timeline's deal-created + stage-change events; the
  // queries share keys with the deal detail view, so navigation reuses cache.
  const relatedDealIds = useMemo(
    () => data.deals.data?.items.filter((deal) => deal.companyId === id).map((deal) => deal.id) ?? [],
    [data.deals.data, id],
  );
  const dealDetailResults = useQueries({
    queries: relatedDealIds.slice(0, TIMELINE_DEAL_LIMIT).map((dealId) => ({
      queryKey: ['crm', 'deals', dealId],
      queryFn: () => getCrmDeal(dealId),
    })),
  });
  // Back always returns to the company list page — and to the exact list the
  // user left (cards/table + filters), falling back to the plain list when
  // they arrived from elsewhere (e.g. a related deal or contact).
  const [backHref, setBackHref] = useState<string | null>(null);
  useEffect(() => {
    const saved = window.sessionStorage.getItem('crm.companies.back');
    if (saved && saved.startsWith(`/${locale}/m/crm/companies`)) setBackHref(saved);
  }, [locale]);

  // Hoisted so every render calls the same hooks (rules-of-hooks).
  const c = company.data;
  const cOwnerTeamId = c?.ownerTeamId ?? null;
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
      ownerUserId: c?.ownerUserId ?? '',
      ownerTeamId: cOwnerTeamId ?? '',
    },
  });

  if (company.isPending)
    return <p className="py-10 text-center text-sm text-muted-foreground">{t('common.loading')}</p>;
  if (company.isError || !c) return <p className="py-10 text-center text-sm text-destructive">{t('errors.unknown')}</p>;
  const relatedContacts = data.contacts.data?.items.filter((contact) => contact.companyId === id) ?? [];
  const relatedDeals = data.deals.data?.items.filter((deal) => deal.companyId === id) ?? [];
  const relatedActivities =
    data.activities.data?.items.filter((a) => a.relatedType === 'company' && a.relatedId === id) ?? [];
  const dealDetails = dealDetailResults
    .map((result) => result.data)
    .filter((deal): deal is CrmDealDetail => deal !== undefined);
  const timeline = buildCrmTimeline({
    createdAt: c.createdAt,
    createdByUserId: c.createdByUserId,
    updatedAt: c.updatedAt,
    updatedByUserId: c.updatedByUserId,
    notes: notes.data?.items ?? [],
    activities: relatedActivities,
    deals: dealDetails,
  });

  const tabs: Array<{ key: CompanyTab; label: string; count?: number }> = [
    { key: 'overview', label: t('detail.overviewTimeline'), count: timeline.length },
    { key: 'contacts', label: t('detail.relatedContacts'), count: relatedContacts.length },
    { key: 'deals', label: t('detail.relatedDeals'), count: relatedDeals.length },
  ];

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
          ownerUserId: values.ownerUserId || null,
          ownerTeamId: values.ownerTeamId || null,
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
          <Link href={backHref ?? `/${locale}/m/crm/companies`}>
            <ArrowLeft className="rtl:rotate-180" />
            {t('detail.back')}
          </Link>
        </Button>
        <h1 className="text-xl font-semibold" dir="auto">
          {c.name}
        </h1>
      </div>

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      <DetailTabs tabs={tabs} value={tab} onChange={setTab} idPrefix="company" />

      <div role="tabpanel" id="company-panel" aria-labelledby={`company-tab-${tab}`} className="space-y-5">
        {tab === 'overview' && (
          <>
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
                  <DetailField label={t('fields.owner')} value={memberName(c.ownerUserId) ?? '—'} />
                  <DetailField
                    label={t('fields.ownerTeam')}
                    value={(() => {
                      const teamName = (teamsData ?? []).find((team) => team.id === cOwnerTeamId)?.name;
                      return teamName ?? '—';
                    })()}
                  />
                  <DetailField label={t('fields.address')} value={addressLine(c.address) || '—'} />
                  <DetailField label={t('detail.created')} value={formatDate(c.createdAt, locale)} />
                  <DetailField label={t('detail.updated')} value={formatDate(c.updatedAt, locale)} />
                  <DetailField label={t('detail.createdBy')} value={memberName(c.createdByUserId) ?? '—'} />
                  <DetailField label={t('detail.updatedBy')} value={memberName(c.updatedByUserId) ?? '—'} />
                </dl>
              )}
            </DetailCard>

            <QuickUpdateComposer relatedType="company" relatedId={id} />

            <DetailCard icon={History} title={t('detail.timeline.title')}>
              <ActivityTimelineFeed
                entries={timeline}
                resolveMember={memberName}
                stageLabel={(stageId) => stageName(data.pipeline.data, stageId, locale)}
                stageStatus={(stageId) => pipelineStageStatus(data.pipeline.data, stageId)}
                recordIcon={Building2}
              />
            </DetailCard>
          </>
        )}

        {tab === 'contacts' && (
          <DetailCard icon={Users} title={t('detail.relatedContacts')}>
            {relatedContacts.length === 0 ? (
              <EmptyState icon={Users}>{t('detail.noRelated')}</EmptyState>
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
        )}

        {tab === 'deals' && (
          <DetailCard icon={Handshake} title={t('detail.relatedDeals')}>
            {relatedDeals.length === 0 ? (
              <EmptyState icon={Handshake}>{t('detail.noRelated')}</EmptyState>
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
        )}
      </div>
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
  const { data: teamsData } = useTeams();
  const { data: membersData } = useOrgMembers();
  const [editing, setEditing] = useState(false);
  const [editOwner, setEditOwner] = useState('');
  const [editTeam, setEditTeam] = useState('');
  const [pendingMove, setPendingMove] = useState<{
    toStage: { id: string; nameI18n: Record<string, string>; isLost: boolean };
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<DealTab>('overview');
  // Notes feed the timeline; the query key is shared with the composer's note
  // mutation invalidation, so react-query keeps it to a single request.
  const notes = useCrmNotes('deal', id);
  // Back always returns to the deals page — and to the exact view the user
  // left (board/table + filters), falling back to the plain board when they
  // arrived from elsewhere (e.g. a related contact or activity).
  const [backHref, setBackHref] = useState<string | null>(null);
  useEffect(() => {
    const saved = window.sessionStorage.getItem('crm.deals.back');
    if (saved && saved.startsWith(`/${locale}/m/crm/deals`)) setBackHref(saved);
  }, [locale]);

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

  // Timeline scoped to this deal: audit stamps + stage transitions + its
  // notes and activities. `showDealCreated` skips a redundant "created" event
  // (the `record-created` entry already covers it for the same record).
  const timeline = buildCrmTimeline({
    createdAt: d.createdAt,
    createdByUserId: d.createdByUserId,
    updatedAt: d.updatedAt,
    updatedByUserId: d.updatedByUserId,
    notes: notes.data?.items ?? [],
    activities: relatedActivities,
    deals: [d],
    showDealCreated: false,
  });

  const tabs: Array<{ key: DealTab; label: string; count?: number }> = [
    { key: 'overview', label: t('detail.overviewTimeline'), count: timeline.length },
  ];

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

  const dOwnerTeamId = d.ownerTeamId ?? null;

  const startEdit = () => {
    setEditOwner(d.ownerUserId ?? '');
    setEditTeam(dOwnerTeamId ?? '');
    setEditing(true);
  };

  const submitOwnership = (event: React.FormEvent) => {
    event.preventDefault();
    mutations.updateDealOwnership
      .mutateAsync({
        id,
        input: { ownerUserId: editOwner || null, ownerTeamId: editTeam || null },
      })
      .then(() => {
        setEditing(false);
        setError(null);
      })
      .catch((err: unknown) => setError(t(crmErrorKey(err))));
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href={backHref ?? `/${locale}/m/crm/deals`}>
            <ArrowLeft className="rtl:rotate-180" />
            {t('detail.back')}
          </Link>
        </Button>
        <h1 className="text-xl font-semibold" dir="auto">
          {d.title}
        </h1>
      </div>

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      <DetailTabs tabs={tabs} value={tab} onChange={setTab} idPrefix="deal" />

      <div role="tabpanel" id="deal-panel" aria-labelledby={`deal-tab-${tab}`} className="space-y-5">
        {tab === 'overview' && (
          <DetailCard
            icon={Handshake}
            title={t('detail.dealDetails')}
            action={
              !editing && (
                <Can permission="crm:deal:write">
                  <Button variant="outline" size="sm" onClick={startEdit}>
                    <Pencil />
                    {t('detail.edit')}
                  </Button>
                </Can>
              )
            }
          >
            {editing ? (
              <form className="grid gap-4 md:grid-cols-2" onSubmit={submitOwnership}>
                <div className="space-y-2">
                  <Label>{t('fields.owner')}</Label>
                  <Select value={editOwner} onValueChange={setEditOwner}>
                    <SelectItem value="">{t('common.none')}</SelectItem>
                    {(membersData ?? [])
                      .filter((m) => m.status === 'active')
                      .map((m) => (
                        <SelectItem key={m.userId} value={m.userId}>
                          {m.name || m.email}
                        </SelectItem>
                      ))}
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{t('fields.ownerTeam')}</Label>
                  <Select value={editTeam} onValueChange={setEditTeam}>
                    <SelectItem value="">{t('common.none')}</SelectItem>
                    {(teamsData ?? []).map((team: { id: string; name: string }) => (
                      <SelectItem key={team.id} value={team.id}>
                        {team.name}
                      </SelectItem>
                    ))}
                  </Select>
                </div>
                <div className="flex gap-2 md:col-span-2">
                  <Button loading={mutations.updateDealOwnership.isPending}>{t('detail.save')}</Button>
                  <Button variant="ghost" type="button" onClick={() => setEditing(false)}>
                    {t('detail.cancel')}
                  </Button>
                </div>
              </form>
            ) : (
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
                <DetailField label={t('fields.owner')} value={memberName(d.ownerUserId) ?? '—'} />
                <DetailField
                  label={t('fields.ownerTeam')}
                  value={(teamsData ?? []).find((team) => team.id === dOwnerTeamId)?.name ?? '—'}
                />
                <DetailField label={t('detail.expectedClose')} value={formatDate(d.expectedCloseDate, locale)} />
                <DetailField label={t('detail.closed')} value={formatDate(d.closedAt, locale)} />
                <DetailField label={t('detail.lostReason')} value={d.lostReasonCode ?? '—'} />
                <DetailField label={t('detail.created')} value={formatDate(d.createdAt, locale)} />
                <DetailField label={t('detail.createdBy')} value={memberName(d.createdByUserId) ?? '—'} />
                <DetailField label={t('detail.updatedBy')} value={memberName(d.updatedByUserId) ?? '—'} />
              </dl>
            )}
          </DetailCard>
        )}

        {tab === 'overview' && <QuickUpdateComposer relatedType="deal" relatedId={id} />}

        {tab === 'overview' && (
          <DetailCard icon={History} title={t('detail.timeline.title')}>
            <ActivityTimelineFeed
              entries={timeline}
              resolveMember={memberName}
              stageLabel={(stageId) => stageName(pipeline.data, stageId, locale)}
              stageStatus={(stageId) => pipelineStageStatus(pipeline.data, stageId)}
              recordIcon={Handshake}
            />
          </DetailCard>
        )}
      </div>

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
    </div>
  );
}

// ─── Activity detail ────────────────────────────────────────────────────────

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
  // Back always returns to the activities page — and to the exact view the
  // user left (cards/table + filters), falling back to the plain cards page
  // when they arrived from elsewhere (e.g. a related contact or deal).
  const [backHref, setBackHref] = useState<string | null>(null);
  useEffect(() => {
    const saved = window.sessionStorage.getItem('crm.activities.back');
    if (saved && saved.startsWith(`/${locale}/m/crm/activities`)) setBackHref(saved);
  }, [locale]);

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
          <Link href={backHref ?? `/${locale}/m/crm/activities`}>
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
