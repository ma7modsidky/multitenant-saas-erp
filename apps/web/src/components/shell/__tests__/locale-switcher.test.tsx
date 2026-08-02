// @vitest-environment jsdom

import messages from '@modubiz/i18n/messages/en';
import { fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let pathname = '/en/settings/members';

vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
}));

import { LocaleSwitcher } from '../locale-switcher';

function renderSwitcher() {
  return render(
    <NextIntlClientProvider messages={messages} locale="en">
      <LocaleSwitcher />
    </NextIntlClientProvider>,
  );
}

describe('LocaleSwitcher — dropdown language selector', () => {
  beforeEach(() => {
    pathname = '/en/settings/members';
  });

  it('shows the current locale shortcode on the closed trigger and opens a dropdown listing every language', () => {
    renderSwitcher();

    const trigger = screen.getByRole('button', { name: 'Language' });
    expect(trigger).toHaveTextContent('EN');

    fireEvent.click(trigger);

    // The menu is a div (not a list) — assert its contents directly.
    expect(screen.getByRole('link', { name: 'English' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'العربية' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Français' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Español' })).toBeInTheDocument();
  });

  it('marks the active locale with aria-current and swaps the locale segment in the current path', () => {
    renderSwitcher();

    fireEvent.click(screen.getByRole('button', { name: 'Language' }));

    const englishLink = screen.getByRole('link', { name: 'English' });
    expect(englishLink).toHaveAttribute('aria-current', 'true');
    // en → ar keeps the rest of the path; /en/settings/members → /ar/settings/members
    expect(screen.getByRole('link', { name: 'العربية' })).toHaveAttribute('href', '/ar/settings/members');
    expect(screen.getByRole('link', { name: 'Français' })).toHaveAttribute('href', '/fr/settings/members');
  });

  it('swaps to /<code> when the current path is the bare locale root', () => {
    pathname = '/en';
    renderSwitcher();

    fireEvent.click(screen.getByRole('button', { name: 'Language' }));

    expect(screen.getByRole('link', { name: 'العربية' })).toHaveAttribute('href', '/ar');
    expect(screen.getByRole('link', { name: 'Français' })).toHaveAttribute('href', '/fr');
  });

  it('closes the dropdown when Escape is pressed', () => {
    renderSwitcher();

    fireEvent.click(screen.getByRole('button', { name: 'Language' }));
    expect(screen.getByRole('link', { name: 'English' })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('link', { name: 'English' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Language' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes the dropdown when clicking outside', () => {
    renderSwitcher();

    fireEvent.click(screen.getByRole('button', { name: 'Language' }));
    expect(screen.getByRole('link', { name: 'English' })).toBeInTheDocument();

    // Click on document.body (outside the menu).
    fireEvent.mouseDown(document.body);

    expect(screen.queryByRole('link', { name: 'English' })).not.toBeInTheDocument();
  });

  it('uses logical layout utilities so it works in RTL (no directional CSS)', () => {
    renderSwitcher();

    fireEvent.click(screen.getByRole('button', { name: 'Language' }));

    const menu = screen.getByText('Language').closest('div')!;
    // The dropdown must anchor to the logical "end" (inline-end) — in RTL that
    // flips automatically. Assert no physical left/right class on the menu.
    expect(menu.className).not.toMatch(/\b(left|right)-\d/);
    expect(menu.className).toContain('end-0');
  });
});
