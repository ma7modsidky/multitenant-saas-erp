import { expect, test } from '@playwright/test';

/**
 * E2E journey — member invitation acceptance (AUTH-3 / AUTH-9 / RLS 0009).
 *
 * Covers the exact browser flow that regressed:
 *   1. Owner signs up, creates an organization, invites a member by email
 *   2. The copied invite link carries the invited email (`?email=`)
 *   3. The invitee opens the link signed-out → account-required CTA
 *   4. Signup pre-fills AND locks the email field to the invited address
 *   5. After login the invitation page auto-accepts (email matches RLS
 *      policy user_own_invitations, 0009) instead of failing closed with 404
 *
 * @see docs/TESTING.md §7 — E2E journeys (Playwright)
 *
 * Requires the dev stack to be running with the latest code (API dev uses
 * --watch so it hot-reloads) and the DB to have migration 0009 applied
 * (the user_own_invitations RLS policy) — otherwise the accept read fails
 * closed with 404 and this test fails. Run `pnpm db:migrate` first.
 */
const PASSWORD = 'TestPassword123!';

test('AUTH-3/AUTH-9: invite → signup (locked email) → login → auto-accept', async ({ browser }) => {
  const ts = Date.now();
  const ownerEmail = `owner-${ts}@example.com`;
  const memberEmail = `member-${ts}@example.com`;
  const orgName = `Acme ${ts}`;
  const orgSlug = `acme-${ts}`;

  // ─── Owner: signup → login → create org → invite ───────────────────────
  const ownerContext = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const owner = await ownerContext.newPage();

  await owner.goto('/en/signup');
  await owner.fill('#signup-name', 'Owner User');
  await owner.fill('#signup-email', ownerEmail);
  await owner.fill('#signup-password', PASSWORD);
  await owner.getByRole('button', { name: 'Sign up' }).click();

  // Signup success → hop to login
  await owner.getByRole('button', { name: 'Log in' }).click();
  await owner.waitForURL('**/en/login**');
  await owner.fill('#login-email', ownerEmail);
  await owner.fill('#login-password', PASSWORD);
  await owner.getByRole('button', { name: 'Log in' }).click();
  await owner.waitForURL('**/en**');

  // Create the organization (dashboard onboarding form)
  await expect(owner.locator('#org-name')).toBeVisible();
  await owner.fill('#org-name', orgName);
  await owner.fill('#org-slug', orgSlug);
  await owner.getByRole('button', { name: 'Create organization' }).click();

  // After switch-org the topbar shows the org name
  await expect(owner.getByText(orgName).first()).toBeVisible({ timeout: 15_000 });

  // Members page
  await owner.goto('/en/settings/members');
  await expect(owner.locator('#invite-email')).toBeVisible();

  // Invite the member — capture the invitation id from the API response
  const inviteResponse = owner.waitForResponse(
    (res) =>
      res.url().includes('/v1/organizations/') &&
      res.url().endsWith('/invitations') &&
      res.request().method() === 'POST',
  );
  // The invite form now collects the invitee NAME next to the email
  // (migration 0012) — the invitations list and the public invite page show it.
  await owner.fill('#invite-name', 'Invitee User');
  await owner.fill('#invite-email', memberEmail);
  // The fresh org seeds all five system roles (AUTH-10 + migration 0010):
  // option index 0 is the disabled placeholder, 1..5 are the roles.
  await expect(owner.locator('#invite-role option')).toHaveCount(6);
  // Pick the 'member' role by label (not index) so the invitee lands as a
  // non-owner member — exercising the full role matrix from the dropdown.
  await owner.selectOption('#invite-role', { label: 'Member' });
  await owner.getByRole('button', { name: 'Send invitation' }).click();
  const inviteResp = await inviteResponse;
  // eslint-disable-next-line no-restricted-syntax -- unavoidable JSON boundary cast in the E2E test
  const inviteBody = (await inviteResp.json()) as { data: { invitationId: string } };
  const invitationId = inviteBody.data.invitationId;
  expect(invitationId).toBeTruthy();
  await expect(owner.getByText('Invitation sent.')).toBeVisible();

  // Copy the invite link — the clipboard must carry the invitation id, the
  // invited email (?email=) so the signup form can lock it, and the display
  // metadata (?name=&org=&role=) so the public invite page can greet the
  // invitee before they authenticate.
  await owner.getByRole('button', { name: 'Copy invite link' }).click();
  await expect(owner.getByText('Link copied to clipboard.')).toBeVisible();
  const copiedLink = await owner.evaluate(() => navigator.clipboard.readText());
  expect(copiedLink).toContain(`/en/invitations/${invitationId}`);
  // The page builds the link with URLSearchParams (spaces → `+`, not `%20`),
  // so the expected substrings are built the same way.
  const expectedParams = new URLSearchParams({
    email: memberEmail,
    name: 'Invitee User',
    org: orgName,
    role: 'Member',
  });
  expect(copiedLink).toContain(`?${expectedParams.toString()}`);
  await ownerContext.close();

  // ─── Invitee: signed-out browser, opens the invite link ─────────────────
  const inviteeContext = await browser.newContext();
  const invitee = await inviteeContext.newPage();

  // Open the REAL copied link (email + name + org + role display metadata) —
  // this is the exact URL an inviter would send the invitee.
  await invitee.goto(copiedLink);

  // No session → account-required CTA with signup/login links. The public
  // invite page greets the invitee with who/where/what (migration 0012
  // display metadata) BEFORE they sign up — assert it here, while still on
  // the invite page in the needsAccount state.
  await expect(invitee.getByRole('link', { name: 'Create account' })).toBeVisible();
  await expect(invitee.getByText('Invitee User')).toBeVisible();
  await expect(invitee.getByText('Invited to join ' + orgName)).toBeVisible();
  await expect(invitee.getByText('Role: Member')).toBeVisible();
  await invitee.getByRole('link', { name: 'Create account' }).click();
  await invitee.waitForURL('**/en/signup**');

  // AUTH-9: the email field is pre-filled and locked to the invited address
  const emailField = invitee.locator('#signup-email');
  await expect(emailField).toHaveValue(memberEmail);
  await expect(emailField).toHaveAttribute('readonly', '');

  await invitee.fill('#signup-name', 'Invitee User');
  await invitee.fill('#signup-password', PASSWORD);
  await invitee.getByRole('button', { name: 'Sign up' }).click();

  // Signup success → hop to login (email still carried + prefilled)
  await invitee.getByRole('button', { name: 'Log in' }).click();
  await invitee.waitForURL('**/en/login**');
  await expect(invitee.locator('#login-email')).toHaveValue(memberEmail);
  await invitee.fill('#login-password', PASSWORD);
  await invitee.getByRole('button', { name: 'Log in' }).click();

  // Login redirects back to the invitation link → auto-accept fires.
  // The accept must succeed (email matches the user_own_invitations RLS
  // policy 0009) — the regression this test guards against returned 404
  // here and rendered "This invitation link is invalid."
  await invitee.waitForURL(`**/en/invitations/${invitationId}**`);
  await expect(invitee.getByText('Invitation accepted. You have joined the organization.')).toBeVisible({
    timeout: 15_000,
  });

  // Success redirects to the dashboard after a short delay
  await invitee.waitForURL((url) => url.pathname === '/en', { timeout: 15_000 });
  await inviteeContext.close();
});
