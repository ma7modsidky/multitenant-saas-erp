// @vitest-environment jsdom

import messages from '@modubiz/i18n/messages/en';
import { render } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it } from 'vitest';

import { LocaleDirectionSync } from '../locale-direction-sync';

/**
 * Render the sync inside a NextIntlClientProvider with a FIXED locale and
 * assert the <html> attributes it writes on mount.
 *
 * The real bug: a client-side locale switch re-renders the page under the
 * existing <html lang>/<html dir> (set once by the server layout), so an ar
 * switch kept the document LTR until a full refresh. This component writes the
 * attributes on every locale change from the client.
 */
function renderSync(locale: string) {
  return render(
    <NextIntlClientProvider messages={messages} locale={locale}>
      <LocaleDirectionSync />
    </NextIntlClientProvider>,
  );
}

describe('LocaleDirectionSync — RTL/LTR on client-side locale switch', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('dir');
    document.documentElement.removeAttribute('lang');
  });

  it('sets dir=rtl and lang=ar when the active locale is Arabic', () => {
    renderSync('ar');
    expect(document.documentElement.dir).toBe('rtl');
    expect(document.documentElement.lang).toBe('ar');
  });

  it('keeps dir=ltr for English', () => {
    renderSync('en');
    expect(document.documentElement.dir).toBe('ltr');
    expect(document.documentElement.lang).toBe('en');
  });

  it('keeps dir=ltr for French and Spanish (LTR locales)', () => {
    renderSync('fr');
    expect(document.documentElement.dir).toBe('ltr');
    expect(document.documentElement.lang).toBe('fr');

    renderSync('es');
    expect(document.documentElement.dir).toBe('ltr');
    expect(document.documentElement.lang).toBe('es');
  });
});
