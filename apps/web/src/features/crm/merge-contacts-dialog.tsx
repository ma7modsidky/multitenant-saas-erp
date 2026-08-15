'use client';

// MergeContactsDialog — search, select, and merge several contacts in one
// flow (CRM-12). Replaces the old two-dropdown merge form: with thousands of
// contacts a dropdown can't find anything, so the dialog always starts from a
// server-side search over ALL contacts, and the table view pre-seeds it with
// rows the user already selected.
//
// Flow: search → add contacts to the selection → pick the SURVIVOR (radio) →
// confirm. Every non-survivor is merged into the survivor sequentially; each
// merge moves related records (deals, activities, notes, attachments) and
// soft-deletes the source (see MergeContactsUseCase).

import { Merge, Plus, Search, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CRM_PAGE_SIZE } from '@/lib/api/resources';
import { cn } from '@/components/cn';

import { crmErrorKey } from './errors';
import { useContactsList, useCrmMutations } from './hooks';

/** A selectable contact — just enough for the merge plan. */
export interface MergeContactOption {
  id: string;
  name: string;
}

/**
 * The merge plan from a selection: every contact except the survivor is a
 * source, and sources are merged into the survivor one at a time.
 */
export function computeMergePlan(selected: MergeContactOption[], survivorId: string): string[] {
  return selected.filter((contact) => contact.id !== survivorId).map((contact) => contact.id);
}

interface MergeContactsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Rows already selected in the table view — seeded into the dialog. */
  initialSelection?: MergeContactOption[];
  /** Called once all merges succeed (the table clears its selection). */
  onMerged?: () => void;
}

export function MergeContactsDialog({ open, onOpenChange, initialSelection, onMerged }: MergeContactsDialogProps) {
  const t = useTranslations('modules.crm');
  const mutations = useCrmMutations();

  const [selected, setSelected] = useState<MergeContactOption[]>([]);
  const [survivorId, setSurvivorId] = useState('');
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Seed only on the closed → open transition (not on every parent render),
  // so in-dialog edits survive re-renders while open.
  const initialRef = useRef(initialSelection);
  const wasOpen = useRef(false);
  useEffect(() => {
    initialRef.current = initialSelection;
    if (open && !wasOpen.current) {
      const seed = initialRef.current ?? [];
      setSelected(seed);
      setSurvivorId(seed[0]?.id ?? '');
      setQuery('');
      setDebouncedQuery('');
      setError(null);
    }
    wasOpen.current = open;
  }, [open, initialSelection]);

  // Debounce the search box into the API query (same rhythm as the tables).
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(id);
  }, [query]);

  // exactOptionalPropertyTypes: only pass `search` when the user typed one.
  const results = useContactsList({
    ...(debouncedQuery ? { search: debouncedQuery } : {}),
    pageSize: CRM_PAGE_SIZE,
  });
  const selectedIds = new Set(selected.map((c) => c.id));
  const candidates = (results.data?.items ?? []).filter((c) => !selectedIds.has(c.id));

  const addContact = (id: string, name: string) => {
    setSelected((prev) => [...prev, { id, name }]);
    setSurvivorId((prev) => prev || id);
  };
  const removeContact = (id: string) => {
    setSelected((prev) => {
      const next = prev.filter((c) => c.id !== id);
      setSurvivorId((survivor) => (survivor === id ? (next[0]?.id ?? '') : survivor));
      return next;
    });
  };

  const sources = computeMergePlan(selected, survivorId);
  const canMerge =
    selected.length >= 2 && survivorId !== '' && sources.length > 0 && !mutations.mergeContacts.isPending;

  const runMerge = async () => {
    if (!canMerge) return;
    setError(null);
    try {
      // Sequential: each source is merged into the SAME survivor, so the
      // survivor is never soft-deleted and records accumulate on it (CRM-12).
      for (const sourceId of sources) {
        await mutations.mergeContacts.mutateAsync({ sourceContactId: sourceId, targetContactId: survivorId });
        setSelected((prev) => prev.filter((c) => c.id !== sourceId));
      }
      onMerged?.();
      onOpenChange(false);
    } catch (err) {
      setError(t(crmErrorKey(err)));
    }
  };

  // Escape closes (suppressed while a merge is running).
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !mutations.mergeContacts.isPending) onOpenChange(false);
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, mutations.mergeContacts.isPending, onOpenChange]);

  if (!open) return null;

  const contactName = (contact: { firstName: string; lastName: string; email: string | null }) =>
    [contact.firstName, contact.lastName].filter(Boolean).join(' ') || contact.email || '—';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="merge-dialog-title"
    >
      {/* Backdrop — visual dismissal only; Escape + Cancel cover keyboard users. */}
      <button
        type="button"
        className="absolute inset-0 bg-black/50 cursor-default"
        onClick={() => {
          if (!mutations.mergeContacts.isPending) onOpenChange(false);
        }}
        disabled={mutations.mergeContacts.isPending}
        aria-hidden="true"
        tabIndex={-1}
      />
      <div className="relative w-full max-w-lg outline-none animate-fade-in">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-4">
              <CardTitle id="merge-dialog-title" className="text-base">
                {t('contacts.merge')}
              </CardTitle>
              <Button
                variant="ghost"
                size="icon"
                className="-me-1 -mt-1 size-7"
                onClick={() => {
                  if (!mutations.mergeContacts.isPending) onOpenChange(false);
                }}
                disabled={mutations.mergeContacts.isPending}
                aria-label={t('errors.dismiss')}
              >
                <X className="size-4" aria-hidden="true" />
              </Button>
            </div>
          </CardHeader>

          <CardContent className="space-y-4 pt-0">
            <p className="text-sm text-muted-foreground">{t('contacts.mergeSelectHint')}</p>

            {/* Search over ALL contacts (server-side) — the table rows on the
                current page are only a slice of what can be merged. */}
            <div className="relative">
              <Search
                className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('contacts.mergeSearchPlaceholder')}
                className="ps-9"
              />
            </div>

            {candidates.length > 0 && (
              <ul className="max-h-44 space-y-1 overflow-y-auto rounded-lg border bg-muted/20 p-1.5">
                {candidates.map((contact) => {
                  const name = contactName(contact);
                  return (
                    <li key={contact.id}>
                      <button
                        type="button"
                        onClick={() => addContact(contact.id, name)}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent"
                      >
                        <Plus className="size-4 shrink-0 text-primary" aria-hidden="true" />
                        <span className="min-w-0 flex-1 truncate text-start" dir="auto">
                          {name}
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground" dir="auto">
                          {contact.email}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {debouncedQuery !== '' && candidates.length === 0 && !results.isPending && (
              <p className="text-sm text-muted-foreground">{t('common.empty')}</p>
            )}

            {/* Selected contacts + survivor choice. */}
            {selected.length > 0 && (
              <fieldset>
                <legend className="mb-1.5 text-sm font-medium text-muted-foreground">
                  {t('contacts.mergeTarget')}
                </legend>
                <ul className="space-y-1.5">
                  {selected.map((contact) => (
                    <li key={contact.id} className="flex items-center gap-2 rounded-lg border bg-card px-2.5 py-2">
                      <input
                        id={`survivor-${contact.id}`}
                        type="radio"
                        name="merge-survivor"
                        checked={survivorId === contact.id}
                        onChange={() => setSurvivorId(contact.id)}
                        className="size-4 shrink-0 accent-primary"
                      />
                      <Label
                        htmlFor={`survivor-${contact.id}`}
                        className="min-w-0 flex-1 cursor-pointer truncate text-sm font-normal"
                        dir="auto"
                      >
                        {contact.name}
                      </Label>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="size-7 p-0"
                        onClick={() => removeContact(contact.id)}
                        disabled={mutations.mergeContacts.isPending}
                        aria-label={t('contacts.mergeRemove')}
                      >
                        <X className="size-3.5" aria-hidden="true" />
                      </Button>
                    </li>
                  ))}
                </ul>
                <p className="mt-1.5 text-xs text-muted-foreground">{t('contacts.mergeHint')}</p>
              </fieldset>
            )}

            {error && (
              <div
                role="alert"
                className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {error}
              </div>
            )}
          </CardContent>

          <CardFooter className="justify-between gap-2 border-t pt-3">
            <p className={cn('text-sm text-muted-foreground', selected.length >= 2 && 'hidden sm:block')}>
              {selected.length > 0 ? t('contacts.selectedCount', { count: selected.length }) : ''}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  if (!mutations.mergeContacts.isPending) onOpenChange(false);
                }}
                disabled={mutations.mergeContacts.isPending}
              >
                {t('common.cancel')}
              </Button>
              <Button
                onClick={() => void runMerge()}
                loading={mutations.mergeContacts.isPending}
                disabled={!canMerge && !mutations.mergeContacts.isPending}
              >
                <Merge className="size-4" aria-hidden="true" />
                {t('contacts.mergeConfirmCount', { count: selected.length })}
              </Button>
            </div>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
