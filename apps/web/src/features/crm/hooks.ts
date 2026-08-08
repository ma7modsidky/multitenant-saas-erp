'use client';

import { keepPreviousData, useMutation, useQuery, useQueries, useQueryClient } from '@tanstack/react-query';

import {
  completeCrmActivity,
  createCrmActivity,
  createCrmCompany,
  createCrmContact,
  createCrmDeal,
  createCrmNote,
  getActiveOrganization,
  getCrmActivities,
  getCrmActivity,
  getCrmCompanies,
  getCrmCompany,
  getCrmContact,
  getCrmContacts,
  getCrmNotes,
  getCurrencies,
  getFxRate,
  getCrmDeal,
  getCrmDeals,
  getCrmPipeline,
  mergeCrmContacts,
  moveCrmDeal,
  updateCrmActivity,
  updateCrmCompany,
  updateCrmContact,
  type CrmActivityUpdate,
  CRM_PAGE_SIZE,
  type CrmContactListParams,
  type CrmListParams,
} from '@/lib/api/resources';
import { useSession } from '@/lib/auth/session-context';

// Shared member-name resolver — moved to lib/hooks so other modules (e.g.
// inventory) can render audit stamps without importing CRM feature code.
export { useMemberName, useOrgMembers } from '@/lib/hooks/use-member-name';

/** Stable query key for a paginated contacts list (cache + invalidation). */
function contactsKey(params: CrmContactListParams = {}): string[] {
  return [
    'crm',
    'contacts',
    params.search ?? '',
    params.companyId ?? '',
    String(params.page ?? 1),
    String(params.pageSize ?? CRM_PAGE_SIZE),
  ];
}

/** Stable query key for a paginated companies list. */
function companiesKey(params: CrmListParams = {}): string[] {
  return ['crm', 'companies', params.search ?? '', String(params.page ?? 1), String(params.pageSize ?? CRM_PAGE_SIZE)];
}

/** Key segment for an optional CRM list param ('' when absent). */
const keyPart = (value: string | undefined): string => value ?? '';

/** Stable query key for a paginated deals list. */
function dealsKey(params: CrmListParams = {}): string[] {
  return [
    'crm',
    'deals',
    keyPart(params.search),
    keyPart(params.stageId),
    keyPart(params.status),
    keyPart(params.fromDate),
    keyPart(params.toDate),
    keyPart(params.sortBy),
    keyPart(params.sortDir),
    String(params.page ?? 1),
    String(params.pageSize ?? CRM_PAGE_SIZE),
  ];
}

/** Stable query key for a paginated activities list. */
function activitiesKey(params: CrmListParams = {}): string[] {
  return [
    'crm',
    'activities',
    params.search ?? '',
    params.fromDate ?? '',
    params.toDate ?? '',
    params.assigneeUserId ?? '',
    params.unassigned ? 'unassigned' : '',
    params.completed === undefined ? '' : String(params.completed),
    String(params.page ?? 1),
    String(params.pageSize ?? CRM_PAGE_SIZE),
  ];
}

/** Paginated contacts list for the workspace (most recent first). */
export function useContactsList(params: CrmContactListParams = {}) {
  return useQuery({
    queryKey: contactsKey(params),
    queryFn: () => getCrmContacts(params),
    placeholderData: keepPreviousData,
  });
}

/** Paginated companies list for the workspace (most recent first). */
export function useCompaniesList(params: CrmListParams = {}) {
  return useQuery({
    queryKey: companiesKey(params),
    queryFn: () => getCrmCompanies(params),
    placeholderData: keepPreviousData,
  });
}

/** Paginated deals list (most recently updated first). */
export function useDealsList(params: CrmListParams = {}) {
  return useQuery({
    queryKey: dealsKey(params),
    queryFn: () => getCrmDeals(params),
    placeholderData: keepPreviousData,
  });
}

/** Column date-filter presets for the pipeline board. */
export type DealColumnDateFilter = 'today' | 'week' | 'month' | 'all';

/**
 * Local-date day range (YYYY-MM-DD) for a board column preset, on `updated_at`
 * (deals touched in the period). `all` means no date bounds at all.
 * - today → [today, today]
 * - week  → [today − 6 days, today] (rolling week)
 * - month → [1st of this month, today]
 */
export function dealColumnDateRange(filter: DealColumnDateFilter): { fromDate?: string; toDate?: string } {
  const now = new Date();
  const iso = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const today = iso(now);
  if (filter === 'all') return {};
  if (filter === 'today') return { fromDate: today, toDate: today };
  if (filter === 'week') {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
    return { fromDate: iso(start), toDate: today };
  }
  return { fromDate: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`, toDate: today };
}

/**
 * Per-column board queries — one `GET /v1/crm/deals` per pipeline stage with
 * that column's date range. Each result carries its own exact `total` and
 * `totalValueBaseMinor` (server-side sum, independent of the 100-row clamp).
 * The returned array aligns with `stages`; pass `undefined` before the
 * pipeline has loaded (yields an empty array, no requests).
 */
export function useDealsBoard(
  stages: Array<{ id: string }> | undefined,
  filters: Record<string, DealColumnDateFilter>,
  search = '',
) {
  return useQueries({
    queries: (stages ?? []).map((stage) => {
      const { fromDate, toDate } = dealColumnDateRange(filters[stage.id] ?? 'today');
      return {
        queryKey: ['crm', 'deals', 'board', stage.id, fromDate ?? '', toDate ?? '', search, String(100)],
        queryFn: () =>
          getCrmDeals({
            stageId: stage.id,
            pageSize: 100,
            ...(fromDate ? { fromDate } : {}),
            ...(toDate ? { toDate } : {}),
            ...(search ? { search } : {}),
          }),
        placeholderData: keepPreviousData,
      };
    }),
  });
}

/** Paginated activities list (incomplete first, soonest due first). */
export function useActivitiesList(params: CrmListParams = {}) {
  return useQuery({
    queryKey: activitiesKey(params),
    queryFn: () => getCrmActivities(params),
    placeholderData: keepPreviousData,
  });
}

export function useCrmData() {
  return {
    contacts: useQuery({
      queryKey: contactsKey({ page: 1, pageSize: CRM_PAGE_SIZE * 10 }),
      queryFn: () => getCrmContacts({ page: 1, pageSize: CRM_PAGE_SIZE * 10 }),
    }),
    companies: useQuery({
      queryKey: companiesKey({ page: 1, pageSize: CRM_PAGE_SIZE * 10 }),
      queryFn: () => getCrmCompanies({ page: 1, pageSize: CRM_PAGE_SIZE * 10 }),
    }),
    // Deals at the API's 100-row clamp so detail views and selectors see a
    // broad set. The workspace board fetches its own page (defaulting to
    // today's updated_at range), so its query key includes fromDate/toDate
    // and does not share this cache. Contacts/companies likewise fetch a
    // large page for selectors; the workspace list views use the paginated
    // hooks above.
    deals: useQuery({
      queryKey: dealsKey({ page: 1, pageSize: 100 }),
      queryFn: () => getCrmDeals({ page: 1, pageSize: 100 }),
    }),
    activities: useQuery({
      queryKey: activitiesKey({ page: 1, pageSize: CRM_PAGE_SIZE * 10 }),
      queryFn: () => getCrmActivities({ page: 1, pageSize: CRM_PAGE_SIZE * 10 }),
    }),
    pipeline: useQuery({ queryKey: ['crm', 'pipeline'], queryFn: getCrmPipeline }),
  };
}

export function useCrmContactDetail(id: string) {
  return useQuery({ queryKey: ['crm', 'contacts', id], queryFn: () => getCrmContact(id) });
}

export function useCrmCompanyDetail(id: string) {
  return useQuery({ queryKey: ['crm', 'companies', id], queryFn: () => getCrmCompany(id) });
}

export function useCrmDealDetail(id: string) {
  return useQuery({ queryKey: ['crm', 'deals', id], queryFn: () => getCrmDeal(id) });
}

export function useCrmActivityDetail(id: string) {
  return useQuery({ queryKey: ['crm', 'activities', id], queryFn: () => getCrmActivity(id) });
}

/** ISO currency reference data (`/v1/currencies`), used by the deal form. */
export function useCurrencies() {
  return useQuery({ queryKey: ['fx', 'currencies'], queryFn: getCurrencies });
}

/**
 * Latest FX rate for a pair — drives the deal-form base-currency preview.
 * Disabled when the pair is missing or the currencies are identical
 * (no conversion needed). Returns null when no snapshot exists.
 */
export function useFxRate(base: string | null | undefined, quote: string | null | undefined) {
  return useQuery({
    queryKey: ['fx', 'rates', base, quote],
    queryFn: () => {
      if (!base || !quote || base === quote) return Promise.resolve(null);
      return getFxRate(base, quote);
    },
    enabled: Boolean(base && quote && base !== quote),
  });
}

/**
 * Org base currency (CRM-8). Reuses the dashboard's cached
 * `['organization', organizationId]` query; falls back to USD while loading.
 */
export function useOrgBaseCurrency(): string {
  const { organizationId } = useSession();
  const { data } = useQuery({
    queryKey: ['organization', organizationId],
    queryFn: getActiveOrganization,
    enabled: organizationId !== null,
  });
  return data?.data.baseCurrency ?? 'USD';
}

/**
 * Notes for a related entity, newest first.
 */
export function useCrmNotes(relatedType: string, relatedId: string | undefined) {
  return useQuery({
    queryKey: ['crm', 'notes', relatedType, relatedId],
    queryFn: () => getCrmNotes(relatedType, relatedId ?? ''),
    enabled: Boolean(relatedId),
  });
}

export function useCrmMutations() {
  const client = useQueryClient();
  const invalidate = () => client.invalidateQueries({ queryKey: ['crm'] });
  return {
    createContact: useMutation({ mutationFn: createCrmContact, onSuccess: invalidate }),
    mergeContacts: useMutation({
      mutationFn: (v: { sourceContactId: string; targetContactId: string }) =>
        mergeCrmContacts(v.sourceContactId, v.targetContactId),
      onSuccess: invalidate,
    }),
    createCompany: useMutation({ mutationFn: createCrmCompany, onSuccess: invalidate }),
    createDeal: useMutation({ mutationFn: createCrmDeal, onSuccess: invalidate }),
    moveDeal: useMutation({
      mutationFn: (v: { dealId: string; stageId: string; lostReasonCode?: string }) =>
        moveCrmDeal(v.dealId, v.stageId, v.lostReasonCode),
      onSuccess: invalidate,
    }),
    createActivity: useMutation({ mutationFn: createCrmActivity, onSuccess: invalidate }),
    completeActivity: useMutation({ mutationFn: completeCrmActivity, onSuccess: invalidate }),
    updateActivity: useMutation({
      mutationFn: (v: { id: string; input: CrmActivityUpdate }) => updateCrmActivity(v.id, v.input),
      onSuccess: invalidate,
    }),
    updateContact: useMutation({
      mutationFn: (v: { id: string; input: Parameters<typeof updateCrmContact>[1] }) => updateCrmContact(v.id, v.input),
      onSuccess: invalidate,
    }),
    updateCompany: useMutation({
      mutationFn: (v: { id: string; input: Parameters<typeof updateCrmCompany>[1] }) => updateCrmCompany(v.id, v.input),
      onSuccess: invalidate,
    }),
    createNote: useMutation({
      mutationFn: createCrmNote,
      onSuccess: (note) => {
        // Invalidate the specific notes list for the related entity.
        void client.invalidateQueries({ queryKey: ['crm', 'notes', note.relatedType, note.relatedId] });
      },
    }),
  };
}
