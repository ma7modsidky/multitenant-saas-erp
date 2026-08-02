// @vitest-environment jsdom

import messages from '@modubiz/i18n/messages/en';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { sessionStore } from '@/lib/auth/session';

import { LoginForm, SignupForm } from '../auth-form';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const routerReplace = vi.fn();
const routerPush = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: routerReplace, push: routerPush, refresh: vi.fn() }),
  usePathname: () => '/en/login',
}));

function renderForm(next?: string) {
  return render(
    <NextIntlClientProvider messages={messages} locale="en">
      <LoginForm next={next} />
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

  it('redirects to the sanitized next path after login (invitation flow)', async () => {
    const user = { id: 'u1', email: 'a@b.c', name: 'Ana B', preferredLocale: 'en', emailVerified: true };
    vi.stubGlobal(
      'fetch',
      vi.fn(() => jsonResponse(200, { data: { accessToken: 'a1', refreshToken: 'r1', user } })),
    );

    renderForm('/en/invitations/abc-123');

    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'a@b.c' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));

    await waitFor(() => expect(routerReplace).toHaveBeenCalledWith('/en/invitations/abc-123'));
  });

  it('ignores an unsafe (external) next path and redirects to the dashboard', async () => {
    const user = { id: 'u1', email: 'a@b.c', name: 'Ana B', preferredLocale: 'en', emailVerified: true };
    vi.stubGlobal(
      'fetch',
      vi.fn(() => jsonResponse(200, { data: { accessToken: 'a1', refreshToken: 'r1', user } })),
    );

    renderForm('https://evil.example');

    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'a@b.c' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));

    await waitFor(() => expect(routerReplace).toHaveBeenCalledWith('/en'));
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

  it('pre-fills the email field when initialEmail is provided (invitation login)', () => {
    render(
      <NextIntlClientProvider messages={messages} locale="en">
        <LoginForm initialEmail="invitee@example.com" />
      </NextIntlClientProvider>,
    );

    expect(screen.getByLabelText('Email address')).toHaveValue('invitee@example.com');
  });
});

describe('SignupForm', () => {
  beforeEach(() => {
    window.localStorage.clear();
    routerPush.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('pre-fills and locks the email field when initialEmail is provided (invitation signup)', () => {
    render(
      <NextIntlClientProvider messages={messages} locale="en">
        <SignupForm initialEmail="invitee@example.com" />
      </NextIntlClientProvider>,
    );

    const emailInput = screen.getByLabelText('Email address');
    expect(emailInput).toHaveValue('invitee@example.com');
    expect(emailInput).toHaveAttribute('readonly');
    // AUTH-3/AUTH-9: the invited email is the binding identity — the user is
    // told the field cannot be changed.
    expect(
      screen.getByText('This email is the one the invitation was sent to and cannot be changed.'),
    ).toBeInTheDocument();
  });

  it('keeps the email field editable when no invitation email is provided', () => {
    render(
      <NextIntlClientProvider messages={messages} locale="en">
        <SignupForm />
      </NextIntlClientProvider>,
    );

    expect(screen.getByLabelText('Email address')).not.toHaveAttribute('readonly');
  });

  it('carries the invited email into the follow-up login link after signup', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => jsonResponse(200, { data: { message: 'ok' } })),
    );

    render(
      <NextIntlClientProvider messages={messages} locale="en">
        <SignupForm next="/en/invitations/abc-123" initialEmail="invitee@example.com" />
      </NextIntlClientProvider>,
    );

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Invitee' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign up' }));

    // The success screen offers a "Log in" button that carries the invited
    // email into the login URL — click it and assert the exact href.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Log in' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));

    await waitFor(() =>
      expect(routerPush).toHaveBeenCalledWith(
        '/en/login?next=' +
          encodeURIComponent('/en/invitations/abc-123') +
          '&email=' +
          encodeURIComponent('invitee@example.com'),
      ),
    );
  });
});
