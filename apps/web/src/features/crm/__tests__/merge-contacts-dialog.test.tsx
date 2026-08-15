// @vitest-environment jsdom

import messages from '@modubiz/i18n/messages/en';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { computeMergePlan, MergeContactsDialog } from '../merge-contacts-dialog';

const A = { id: 'a0000000-0000-0000-0000-00000000000a', name: 'Ada Lovelace' };
const B = { id: 'b0000000-0000-0000-0000-00000000000b', name: 'Grace Hopper' };
const C = { id: 'c0000000-0000-0000-0000-00000000000c', name: 'Alan Turing' };

// Hoisted `mock`-prefixed spy — shared by the component (via the factory) and
// the tests, so assertions see the exact calls the dialog makes.
const mockMutateAsync = vi.fn().mockResolvedValue(undefined);

vi.mock('../hooks', () => ({
  useContactsList: vi.fn(() => ({
    data: { items: [], total: 0, page: 1, pageSize: 20 },
    isPending: false,
  })),
  useCrmMutations: vi.fn(() => ({
    mergeContacts: { isPending: false, mutateAsync: mockMutateAsync },
    createContact: { isPending: false, mutateAsync: vi.fn().mockResolvedValue(undefined) },
  })),
}));

beforeEach(() => {
  mockMutateAsync.mockReset();
  mockMutateAsync.mockResolvedValue(undefined);
});

function renderDialog(initialSelection = [A, B, C]) {
  const onOpenChange = vi.fn();
  const onMerged = vi.fn();
  const utils = render(
    <NextIntlClientProvider messages={messages} locale="en">
      <MergeContactsDialog open onOpenChange={onOpenChange} initialSelection={initialSelection} onMerged={onMerged} />
    </NextIntlClientProvider>,
  );
  return { onOpenChange, onMerged, ...utils };
}

describe('computeMergePlan (CRM-12)', () => {
  it('returns every contact except the survivor as a source', () => {
    expect(computeMergePlan([A, B, C], B.id)).toEqual([A.id, C.id]);
  });

  it('returns no sources for a single contact (nothing to merge)', () => {
    expect(computeMergePlan([A], A.id)).toEqual([]);
  });

  it('never includes the survivor even if it appears later in the selection', () => {
    expect(computeMergePlan([B, C, A], A.id)).toEqual([B.id, C.id]);
  });
});

describe('MergeContactsDialog', () => {
  it('seeds the selection and defaults the survivor to the first contact', () => {
    renderDialog();

    expect(screen.getByRole('radio', { name: /Ada Lovelace/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Grace Hopper/ })).not.toBeChecked();
    // Three selected → "Merge 3 contacts" (the survivor keeps her records).
    expect(screen.getByRole('button', { name: /Merge 3 contacts/ })).toBeEnabled();
  });

  it('disables merge with fewer than two contacts', () => {
    renderDialog([A]);
    expect(screen.getByRole('button', { name: /Merge 1 contacts/ })).toBeDisabled();
  });

  it('merges every non-survivor into the chosen survivor, in selection order', async () => {
    const { onMerged, onOpenChange } = renderDialog();

    // Grace Hopper survives.
    fireEvent.click(screen.getByRole('radio', { name: /Grace Hopper/ }));
    fireEvent.click(screen.getByRole('button', { name: /Merge 3 contacts/ }));

    // The loop awaits each merge, so the calls settle on microtasks.
    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledTimes(2));
    expect(mockMutateAsync).toHaveBeenNthCalledWith(1, { sourceContactId: A.id, targetContactId: B.id });
    expect(mockMutateAsync).toHaveBeenNthCalledWith(2, { sourceContactId: C.id, targetContactId: B.id });
    await waitFor(() => expect(onMerged).toHaveBeenCalledTimes(1));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('switches the survivor when the current one is removed', () => {
    renderDialog([A, B]);
    // Selection order = DOM order, so the first remove button is Ada's.
    const removeButtons = screen.getAllByRole('button', { name: 'Remove' });
    fireEvent.click(removeButtons[0]!);

    expect(screen.getByRole('radio', { name: /Grace Hopper/ })).toBeChecked();
    expect(screen.queryByRole('radio', { name: /Ada Lovelace/ })).not.toBeInTheDocument();
  });

  it('surfaces a merge failure without closing the dialog', async () => {
    mockMutateAsync.mockRejectedValueOnce(new Error('boom'));
    const { onOpenChange } = renderDialog();

    fireEvent.click(screen.getByRole('button', { name: /Merge 3 contacts/ }));
    await screen.findByRole('alert');

    expect(screen.getByRole('alert')).toHaveTextContent(/Something went wrong/i);
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
