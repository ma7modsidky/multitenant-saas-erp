// @vitest-environment jsdom

import messages from '@modubiz/i18n/messages/en';
import { fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it } from 'vitest';

import { THEME_STORAGE_KEY } from '@/lib/theme';

import { ThemeToggle } from '../theme-toggle';

function renderToggle() {
  return render(
    <NextIntlClientProvider messages={messages} locale="en">
      <ThemeToggle />
    </NextIntlClientProvider>,
  );
}

describe('ThemeToggle — shared light/dark/system cycle control', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.classList.remove('dark');
  });

  it('starts in light mode and cycles to dark, persisting the selection', () => {
    renderToggle();

    const button = screen.getByRole('button', { name: 'Light mode' });
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    fireEvent.click(button);

    expect(screen.getByRole('button', { name: 'Dark mode' })).toBeInTheDocument();
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  });

  it('cycles dark → system → light and restores the system selection from storage', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    renderToggle();

    const dark = screen.getByRole('button', { name: 'Dark mode' });
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    fireEvent.click(dark);
    expect(screen.getByRole('button', { name: 'System mode' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'System mode' }));
    expect(screen.getByRole('button', { name: 'Light mode' })).toBeInTheDocument();
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
  });
});
