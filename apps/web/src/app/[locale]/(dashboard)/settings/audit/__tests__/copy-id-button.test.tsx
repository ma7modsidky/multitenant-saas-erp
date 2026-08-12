// @vitest-environment jsdom

import messages from '@modubiz/i18n/messages/en';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';

import { CopyIdButton } from '../audit-entry-dialog';

describe('CopyIdButton (isolated)', () => {
  it('copies the value via the clipboard API', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    Object.defineProperty(window.navigator, 'clipboard', { value: { writeText }, configurable: true });

    render(
      <NextIntlClientProvider messages={messages} locale="en">
        <CopyIdButton value="abc-123" />
      </NextIntlClientProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Copy ID' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('abc-123'));
  });

  it('never shows a false "Copied" state when the Clipboard API is absent', () => {
    // Simulate a non-secure context: clipboard undefined, click must be a no-op.
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });

    render(
      <NextIntlClientProvider messages={messages} locale="en">
        <CopyIdButton value="abc-123" />
      </NextIntlClientProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Copy ID' }));
    // No "Copied" feedback appears (the click is a silent no-op).
    expect(screen.queryByRole('button', { name: 'Copied' })).not.toBeInTheDocument();
  });
});
