// @vitest-environment jsdom

import messages from '@modubiz/i18n/messages/en';
import { Users } from 'lucide-react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';

import type { CrmTimelineEntry } from '../timeline';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}));

const mutations = vi.hoisted(() => ({
  createNote: vi.fn(),
  createActivity: vi.fn(),
}));

vi.mock('@/features/crm/hooks', () => ({
  useCrmMutations: () => ({
    createNote: { mutate: mutations.createNote, isPending: false },
    createActivity: { mutate: mutations.createActivity, isPending: false },
  }),
}));

import { ActivityTimelineFeed, QuickUpdateComposer } from '../details';
import type { TimelineContext } from '../details';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const startOfToday = new Date(new Date().setHours(0, 0, 0, 0)).getTime();

function renderWithIntl(node: React.ReactNode) {
  return render(
    <NextIntlClientProvider messages={messages} locale="en">
      {node}
    </NextIntlClientProvider>,
  );
}

describe('QuickUpdateComposer', () => {
  it('adds a note for the related record without a modal', async () => {
    const user = userEvent.setup();
    renderWithIntl(<QuickUpdateComposer relatedType="contact" relatedId="r1" />);

    await user.type(screen.getByPlaceholderText('Write a note…'), 'Hello');
    await user.click(screen.getByRole('button', { name: 'Add note' }));

    expect(mutations.createNote).toHaveBeenCalledWith(
      { body: 'Hello', relatedType: 'contact', relatedId: 'r1' },
      expect.anything(),
    );
    expect(mutations.createActivity).not.toHaveBeenCalled();
  });

  it('logs an activity with the typed text as its subject', async () => {
    const user = userEvent.setup();
    renderWithIntl(<QuickUpdateComposer relatedType="company" relatedId="r2" />);

    await user.click(screen.getByRole('button', { name: 'Log activity' }));
    await user.type(screen.getByPlaceholderText('Write a note…'), 'Called the office');
    await user.click(screen.getByRole('button', { name: 'Log activity' }));

    expect(mutations.createActivity).toHaveBeenCalledWith(
      expect.objectContaining({ subject: 'Called the office', type: 'call', relatedType: 'company', relatedId: 'r2' }),
      expect.anything(),
    );
  });
});

describe('ActivityTimelineFeed', () => {
  const base: TimelineContext = {
    resolveMember: (userId) => (userId === 'u1' ? 'Alice' : null),
    stageLabel: (stageId) => (stageId === 's1' ? 'Stage A' : stageId === 's2' ? 'Stage B' : '—'),
    stageStatus: (stageId) => (stageId === 's2' ? 'won' : 'open'),
    recordIcon: Users,
  };

  const dealEntry: CrmTimelineEntry = {
    kind: 'deal-created',
    id: 'd1',
    at: startOfToday + HOUR,
    deal: {
      id: 'd1',
      title: 'Platform rollout',
      pipelineId: 'p1',
      stageId: 's2',
      contactId: null,
      companyId: null,
      value: { amountMinor: '100000', currency: 'USD' },
      status: 'won',
      ownerUserId: null,
      exchangeRate: null,
      baseAmountMinor: null,
      expectedCloseDate: null,
      closedAt: null,
      lostReasonCode: null,
      createdByUserId: null,
      updatedByUserId: null,
      createdAt: new Date(startOfToday + HOUR).toISOString(),
      updatedAt: new Date(startOfToday + HOUR).toISOString(),
      stageHistory: [],
    },
  };

  it('renders notes and stage changes with deal context and actor names', () => {
    renderWithIntl(
      <ActivityTimelineFeed
        {...base}
        entries={[
          {
            kind: 'note',
            id: 'n1',
            at: startOfToday + HOUR,
            note: {
              id: 'n1',
              body: 'Quarterly check-in done',
              relatedType: 'contact',
              relatedId: 'r1',
              createdAt: new Date(startOfToday + HOUR).toISOString(),
              updatedAt: new Date(startOfToday + HOUR).toISOString(),
              createdByUserId: 'u1',
              createdByName: null,
            },
          },
          {
            kind: 'stage-changed',
            id: 'h1',
            at: startOfToday - DAY + HOUR,
            entry: {
              id: 'h1',
              fromStageId: 's1',
              toStageId: 's2',
              movedAt: new Date(startOfToday - DAY + HOUR).toISOString(),
              movedBy: 'u1',
              durationSeconds: 60,
            },
            deal: dealEntry.deal,
          },
        ]}
      />,
    );

    expect(screen.getByText('Quarterly check-in done')).toBeInTheDocument();
    expect(screen.getAllByText(/Alice/).length).toBeGreaterThan(0);
    // Deal context line: label + clickable deal title, then the stage badge and
    // the meta line with the actor (TimelineStageChanged three-line format).
    expect(screen.getByText('Stage changed:')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Platform rollout' })).toHaveAttribute('href', '/en/m/crm/deals/d1');
    // The old→new stage badge splits "Stage A → Stage B" across a nested arrow
    // span, so match on normalized textContent instead of a text node.
    expect(
      screen.getByText((_, element) => element?.textContent?.replace(/\s+/g, ' ').trim() === 'Stage A → Stage B'),
    ).toBeInTheDocument();
    expect(screen.getByText(/by Alice/)).toBeInTheDocument();
  });

  it('groups events under date headers and threads them with a rail', () => {
    const { container } = renderWithIntl(
      <ActivityTimelineFeed
        {...base}
        entries={[
          dealEntry,
          { ...dealEntry, id: 'd2', at: startOfToday - DAY + HOUR },
          { ...dealEntry, id: 'd3', at: startOfToday - 40 * DAY },
        ]}
      />,
    );

    const headings = Array.from(container.querySelectorAll('h3')).map((h) => h.textContent);
    expect(headings[0]).toBe('Today');
    expect(headings[1]).toBe('Yesterday');
    expect(headings[2]).toMatch(
      /^(January|February|March|April|May|June|July|August|September|October|November|December) \d{4}$/,
    );
    expect(container.querySelector('ol.border-s')).not.toBeNull();
    expect(container.querySelectorAll('ol.border-s > li')).toHaveLength(3);
  });

  it('caps rendering at 15 events and loads more without refetching', async () => {
    const user = userEvent.setup();
    const entries: CrmTimelineEntry[] = Array.from({ length: 20 }, (_, index) => ({
      ...dealEntry,
      id: `d${index}`,
      at: startOfToday + HOUR + index,
    }));
    const { container } = renderWithIntl(<ActivityTimelineFeed {...base} entries={entries} />);

    expect(container.querySelectorAll('li')).toHaveLength(15);
    await user.click(screen.getByRole('button', { name: 'Load more activities' }));

    expect(container.querySelectorAll('li')).toHaveLength(20);
    expect(screen.queryByRole('button', { name: 'Load more activities' })).not.toBeInTheDocument();
  });

  it('colors deal nodes blue and shows the deal name as a link with its amount', () => {
    const { container } = renderWithIntl(<ActivityTimelineFeed {...base} entries={[dealEntry]} />);

    const link = screen.getByRole('link', { name: 'Platform rollout' });
    expect(link).toHaveAttribute('href', '/en/m/crm/deals/d1');
    expect(screen.getByText(/\$1[,.]?000/)).toBeInTheDocument();
    expect(container.querySelector('li > span')?.className).toContain('bg-blue-500/10');
  });

  it('colors completed activities green and overdue ones red', () => {
    const { container } = renderWithIntl(
      <ActivityTimelineFeed
        {...base}
        entries={[
          {
            kind: 'activity',
            id: 'a1',
            at: startOfToday - 2 * DAY + HOUR,
            activity: {
              id: 'a1',
              type: 'call',
              subject: 'Kickoff call',
              dueAt: new Date(startOfToday - 2 * DAY).toISOString(),
              completedAt: new Date(startOfToday - 2 * DAY + HOUR).toISOString(),
              relatedType: 'contact',
              relatedId: 'r1',
              assignedToUserId: null,
            },
          },
          {
            kind: 'activity',
            id: 'a2',
            at: startOfToday - DAY + HOUR,
            activity: {
              id: 'a2',
              type: 'task',
              subject: 'Send proposal',
              dueAt: new Date(startOfToday - 3 * DAY).toISOString(),
              completedAt: null,
              relatedType: 'contact',
              relatedId: 'r1',
              assignedToUserId: null,
            },
          },
        ]}
      />,
    );

    const tiles = container.querySelectorAll('li > span');
    expect(tiles[0]?.className).toContain('bg-green-500/10');
    expect(tiles[1]?.className).toContain('bg-red-500/10');
  });

  it('renders the timeline empty state when there are no entries', () => {
    renderWithIntl(<ActivityTimelineFeed {...base} entries={[]} />);

    expect(
      screen.getByText('No activity yet — notes, calls, meetings, and edits will appear here.'),
    ).toBeInTheDocument();
  });
});
