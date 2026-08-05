// @vitest-environment jsdom

import messages from '@modubiz/i18n/messages/en';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';

import { DueBadge } from '../due-badge';

/**
 * DueBadge — activity due-state badge. Day math is calendar-based against the
 * local clock, so assertions pin dates relative to `now` at test time.
 */
function renderBadge(dueAt: string | null, completedAt: string | null) {
  render(
    <NextIntlClientProvider messages={messages} locale="en">
      <DueBadge dueAt={dueAt} completedAt={completedAt} />
    </NextIntlClientProvider>,
  );
}

function isoDaysFromNow(days: number, hour = 12): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

describe('DueBadge — activity due-state', () => {
  it('shows Completed for a completed activity regardless of due date', () => {
    renderBadge(isoDaysFromNow(-5), isoDaysFromNow(-1));
    expect(screen.getByText('Completed')).toBeInTheDocument();
  });

  it('renders nothing for an open activity without a due date', () => {
    const { container } = render(
      <NextIntlClientProvider messages={messages} locale="en">
        <DueBadge dueAt={null} completedAt={null} />
      </NextIntlClientProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows Overdue · 3 days ago for a task due 3 days in the past', () => {
    renderBadge(isoDaysFromNow(-3), null);
    expect(screen.getByText(/Overdue · 3 days ago/)).toBeInTheDocument();
  });

  it('shows Due today for a task due today', () => {
    renderBadge(isoDaysFromNow(0, 23), null); // 11pm tonight is still today
    expect(screen.getByText('Due today')).toBeInTheDocument();
  });

  it('shows 5 days left for a task due in 5 days', () => {
    renderBadge(isoDaysFromNow(5), null);
    expect(screen.getByText('5 days left')).toBeInTheDocument();
  });

  it('uses singular wording for a single day', () => {
    renderBadge(isoDaysFromNow(1), null);
    expect(screen.getByText('1 day left')).toBeInTheDocument();
  });
});
