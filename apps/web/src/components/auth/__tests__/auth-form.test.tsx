// @vitest-environment jsdom

import messages from '@modubiz/i18n/messages/en';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';


import { sessionStore } from '@/lib/auth/session';

import { LoginForm } from '../auth-form';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const routerReplace = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: routerReplace, refresh: vi.fn() }),
  usePathname: () => '/en/login',
}));

function renderForm() {
  return render(
    <NextIntlClientProvider messages={messages} locale="en">
      <LoginForm />
    </NextIntlClientProvider>,
  );
}

describe('LoginForm', () => {
  beforeEach(() => {
    window.localStorage.clear();
    routerReplace.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('submits credentials, stores the session, and redirects to the dashboard', async () => {
    const user = { id: 'u1', email: 'a@b.c', name: 'Ana B', preferredLocale: 'en', emailVerified: true };
    vi.stubGlobal(
      'fetch',
      vi.fn(() => jsonResponse(200, { data: { accessToken: 'a1', refreshToken: 'r1', user } })),
    );

    renderForm();

    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'a@b.c' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));

    await waitFor(() => expect(routerReplace).toHaveBeenCalledWith('/en'));
    expect(sessionStore.getAccessToken()).toBe('a1');
    expect(sessionStore.getUser()?.email).toBe('a@b.c');
  });

  it('renders the mapped error message on invalid credentials', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => jsonResponse(401, { error: { code: 'AUTH_INVALID_CREDENTIALS', correlationId: 'c' } })),
    );

    renderForm();

    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'a@b.c' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Invalid email or password.'));
    expect(routerReplace).not.toHaveBeenCalled();
  });
});
