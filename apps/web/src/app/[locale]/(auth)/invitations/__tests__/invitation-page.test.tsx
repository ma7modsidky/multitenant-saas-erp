// @vitest-environment jsdom

import messages from '@modubiz/i18n/messages/en';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { sessionStore } from '@/lib/auth/session';

import AcceptInvitationPage from '../[id]/page';

const routerReplace = vi.fn();

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'inv-123' }),
  useRouter: () => ({ replace: routerReplace }),
}));

vi.mock('@/lib/api/resources', () => ({
  acceptInvitation: vi.fn(),
}));

import { acceptInvitation } from '@/lib/api/resources';

const USER = { id: 'u1', email: 'invitee@example.com', name: 'Invitee', preferredLocale: 'en', emailVerified: false };

function renderPage() {
  return render(
    <NextIntlClientProvider messages={messages} locale="en">
      <AcceptInvitationPage />
    </NextIntlClientProvider>,
  );
}

describe('AcceptInvitationPage', () => {
  beforeEach(() => {
    window.localStorage.clear();
    routerReplace.mockClear();
    vi.mocked(acceptInvitation).mockReset();
    window.history.replaceState({}, '', '/en/invitations/inv-123?email=invitee%40example.com');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fires accept when the session email matches the invited email', async () => {
    vi.mocked(acceptInvitation).mockResolvedValue({ message: 'ok' });
    sessionStore.setTokens({ accessToken: 'a1', refreshToken: 'r1' });
    sessionStore.setUser({ ...USER, email: 'Invitee@Example.com' });

    renderPage();

    await waitFor(() => expect(acceptInvitation).toHaveBeenCalledWith('inv-123'));
  });

  it('routes to the wrong-account state when the session email differs from the invited email', async () => {
    sessionStore.setTokens({ accessToken: 'a1', refreshToken: 'r1' });
    sessionStore.setUser({ ...USER, email: 'someone-else@example.com' });

    renderPage();

    // AUTH-3/AUTH-9: the invitation is bound to the invited email — a session
    // with a different address must not fire the accept call (it would 404 via
    // the user_own_invitations RLS policy 0009).
    await waitFor(() => expect(screen.getByText('Signed in with a different email')).toBeInTheDocument());
    expect(acceptInvitation).not.toHaveBeenCalled();
  });

  it('offers a logout escape hatch from the wrong-account state', async () => {
    sessionStore.setTokens({ accessToken: 'a1', refreshToken: 'r1' });
    sessionStore.setUser({ ...USER, email: 'someone-else@example.com' });

    renderPage();

    await waitFor(() => expect(screen.getByRole('button', { name: 'Log out' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));

    await waitFor(() => expect(screen.getByRole('link', { name: 'Create account' })).toBeInTheDocument());
    expect(sessionStore.getAccessToken()).toBeNull();
  });

  it('shows the account-required state when signed out', async () => {
    renderPage();

    await waitFor(() => expect(screen.getByRole('link', { name: 'Create account' })).toBeInTheDocument());
    expect(acceptInvitation).not.toHaveBeenCalled();
  });

  it('carries the invited email into the signup and login links', async () => {
    renderPage();

    // The invited email lands via the mount effect; waitFor keeps the
    // assertions resilient to renderer changes (and gives the await this
    // async test needs).
    await waitFor(() => {
      const signupLink = screen.getByRole('link', { name: 'Create account' });
      const loginLink = screen.getByRole('link', { name: 'Log in' });

      expect(signupLink.getAttribute('href')).toBe(
        '/en/signup?next=' +
          encodeURIComponent('/en/invitations/inv-123') +
          '&email=' +
          encodeURIComponent('invitee@example.com'),
      );
      expect(loginLink.getAttribute('href')).toBe(
        '/en/login?next=' +
          encodeURIComponent('/en/invitations/inv-123') +
          '&email=' +
          encodeURIComponent('invitee@example.com'),
      );
    });
  });

  it('shows the invitee name, email, organization, and role from the link (display-only)', async () => {
    // The members page copies the link WITH display metadata (?name=&org=&role=)
    // so the public invite page can greet the invitee before they authenticate.
    window.history.replaceState(
      {},
      '',
      '/en/invitations/inv-123?email=' +
        encodeURIComponent('invitee@example.com') +
        '&name=' +
        encodeURIComponent('Jane Cooper') +
        '&org=' +
        encodeURIComponent('Acme Inc') +
        '&role=' +
        encodeURIComponent('Member'),
    );

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Jane Cooper')).toBeInTheDocument();
      expect(screen.getByText('invitee@example.com')).toBeInTheDocument();
      expect(screen.getByText('Invited to join Acme Inc')).toBeInTheDocument();
      expect(screen.getByText('Role: Member')).toBeInTheDocument();
    });
  });

  it('renders the invite summary only when display metadata is present', async () => {
    // No ?name/?org/?role params (e.g. an old link): no summary box is shown.
    window.history.replaceState({}, '', '/en/invitations/inv-123?email=invitee%40example.com');

    renderPage();

    await waitFor(() => expect(screen.getByRole('link', { name: 'Create account' })).toBeInTheDocument());
    expect(screen.queryByText('Invited to join')).not.toBeInTheDocument();
  });
});
