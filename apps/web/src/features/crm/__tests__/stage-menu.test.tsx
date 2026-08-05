// @vitest-environment jsdom

import messages from '@modubiz/i18n/messages/en';
import { fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';

import { StageMenu, type StageMenuOption } from '../stage-menu';

/**
 * StageMenu — compact ⋮ stage switcher on pipeline board cards.
 *
 * The menu portals to document.body with fixed positioning, so these tests
 * assert behaviour (open, list, select, close) rather than coordinates.
 */
const options: StageMenuOption[] = [
  { id: 'stage-1', label: 'New' },
  { id: 'stage-2', label: 'Qualified', isCurrent: true },
  { id: 'stage-3', label: 'Closed lost', isLost: true },
];

function renderMenu(overrides: { disabled?: boolean } = {}) {
  const onSelect = vi.fn();
  const utils = render(
    <NextIntlClientProvider messages={messages} locale="en">
      <StageMenu
        options={options}
        onSelect={onSelect}
        ariaLabel="Move deal"
        {...(overrides.disabled !== undefined ? { disabled: overrides.disabled } : {})}
      />
    </NextIntlClientProvider>,
  );
  return { onSelect, ...utils };
}

describe('StageMenu — compact stage switcher', () => {
  it('renders a compact ⋮ trigger button with menu semantics', () => {
    renderMenu();
    const trigger = screen.getByRole('button', { name: 'Move deal' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens the stage list on click, marking the current stage', () => {
    renderMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Move deal' }));

    expect(screen.getByRole('menu', { name: 'Move deal' })).toBeInTheDocument();
    expect(screen.getAllByRole('menuitem')).toHaveLength(3);
    expect(screen.getByRole('menuitem', { name: /Qualified/ })).toBeInTheDocument();

    // The current stage carries a visible check (opacity-100).
    const check = screen.getByRole('menuitem', { name: /Qualified/ }).querySelector('svg');
    expect(check).toHaveClass('opacity-100');
  });

  it('lists lost stages with a Lost hint', () => {
    renderMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Move deal' }));
    expect(screen.getByRole('menuitem', { name: /Closed lost/ })).toHaveTextContent('Lost');
  });

  it('calls onSelect with the chosen stage id and closes', () => {
    const { onSelect } = renderMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Move deal' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Qualified/ }));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('stage-2');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('selects via keyboard (ArrowDown + Enter)', () => {
    const { onSelect } = renderMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Move deal' }));

    const menu = screen.getByRole('menu');
    fireEvent.keyDown(menu, { key: 'ArrowDown' }); // move from current (index 1) to index 2
    fireEvent.keyDown(menu, { key: 'Enter' });

    expect(onSelect).toHaveBeenCalledWith('stage-3');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('closes on Escape', () => {
    renderMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Move deal' }));
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('closes on an outside pointer down', () => {
    renderMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Move deal' }));
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('does not open when disabled', () => {
    renderMenu({ disabled: true });
    fireEvent.click(screen.getByRole('button', { name: 'Move deal' }));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
