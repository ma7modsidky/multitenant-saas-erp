// @vitest-environment jsdom

import messages from '@modubiz/i18n/messages/en';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const push = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
}));

vi.mock('@/lib/auth/session-context', () => ({
  useSession: () => ({ organizationId: 'org-1', permissions: [] }),
}));

// The debounced query is handed to the mocked useQuery; results are returned
// for any search key so the dropdown renders synchronously after the debounce.
vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: readonly unknown[] }) =>
    queryKey[0] === 'search'
      ? {
          data: {
            query: typeof queryKey[1] === 'string' ? queryKey[1] : '',
            results: [
              {
                moduleKey: 'crm',
                labelKey: 'modules.crm.name',
                results: [
                  {
                    id: 'contact:c-1',
                    title: 'John Doe',
                    description: 'john@example.com',
                    href: '/m/crm/contacts/c-1',
                    icon: 'contact',
                  },
                  { id: 'deal:d-1', title: 'Acme renewal', href: '/m/crm/deals/d-1', icon: 'target' },
                ],
              },
            ],
          },
          isFetching: false,
          isError: false,
        }
      : { data: undefined },
}));

import { SidebarSearch } from '../sidebar-search';

function renderSearch() {
  return render(
    <NextIntlClientProvider messages={messages} locale="en">
      <SidebarSearch />
    </NextIntlClientProvider>,
  );
}

describe('SidebarSearch — federated search', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    push.mockClear();
  });

  it('shows a hint until the query is long enough to search', () => {
    renderSearch();

    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'a' } });

    expect(screen.getByText('Type at least 2 characters to search.')).toBeInTheDocument();
  });

  it('debounces the input, renders grouped results, and navigates on selection', () => {
    renderSearch();

    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'acm' } });

    // Results only appear after the 250ms debounce fires.
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(300);
    });

    // Group header + the two results from the mocked search response.
    expect(screen.getByText('CRM')).toBeInTheDocument();
    const john = screen.getByRole('option', { name: /John Doe/ });
    expect(john).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Acme renewal/ })).toBeInTheDocument();

    fireEvent.click(john);
    expect(push).toHaveBeenCalledWith('/en/m/crm/contacts/c-1');
  });

  it('clears the query and closes after navigating', () => {
    renderSearch();

    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'acm' } });
    act(() => {
      vi.advanceTimersByTime(300);
    });

    fireEvent.click(screen.getByRole('option', { name: /Acme renewal/ }));

    expect(input).toHaveValue('');
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
  });
});
