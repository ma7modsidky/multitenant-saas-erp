// @vitest-environment jsdom

import messages from '@modubiz/i18n/messages/en';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { deleteRole, updateRole } from '@/lib/api/resources';

const h = vi.hoisted(() => ({
  MATRIX: {
    systemRoles: [
      { key: 'OWNER', permissions: ['platform:billing:manage', 'crm:contact:manage'] },
      { key: 'MEMBER', permissions: ['crm:contact:read'] },
    ],
    customRoles: [
      {
        id: 'role-1',
        key: 'sales_manager',
        nameI18n: { en: 'Sales manager' },
        description: null,
        permissions: ['crm:contact:read'],
      },
    ],
    platformPermissions: ['platform:billing:manage'],
    permissionCatalog: ['platform:billing:manage', 'crm:contact:read', 'crm:contact:write'],
  },
}));

vi.mock('@/lib/auth/session-context', () => ({
  useSession: () => ({
    status: 'authenticated',
    user: { id: 'user-1', email: 'owner@example.com', name: 'Owner', preferredLocale: 'en', emailVerified: true },
    organizationId: 'org-1',
    permissions: ['platform:roles:manage'],
    login: vi.fn(),
    switchOrg: vi.fn(),
    logout: vi.fn(),
    setUser: vi.fn(),
  }),
}));

vi.mock('@/lib/api/resources', () => ({
  getRoleMatrix: vi.fn().mockResolvedValue(h.MATRIX),
  createRole: vi.fn().mockResolvedValue({ id: 'role-new' }),
  updateRole: vi.fn().mockResolvedValue({ message: 'Role updated.' }),
  deleteRole: vi.fn().mockResolvedValue({ message: 'Role deleted.' }),
}));

vi.mock('@/lib/permissions', () => ({
  hasPermission: (granted: readonly string[], required: string) => granted.includes(required),
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: h.MATRIX, isFetching: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

import RolesSettingsPage from '../page';

function renderPage() {
  return render(
    <NextIntlClientProvider messages={messages} locale="en">
      <RolesSettingsPage />
    </NextIntlClientProvider>,
  );
}

describe('RolesSettingsPage — permission matrix', () => {
  beforeEach(() => {
    vi.mocked(updateRole).mockClear();
    vi.mocked(deleteRole).mockClear();
  });

  it('shows system-role grants as read-only and custom roles as checkboxes', async () => {
    renderPage();

    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());

    // Custom role: the granted permission is checked, the other is not.
    const granted = screen.getByRole('checkbox', { name: 'Toggle crm:contact:read for Sales manager' });
    expect(granted).toBeChecked();
    const unset = screen.getByRole('checkbox', { name: 'Toggle crm:contact:write for Sales manager' });
    expect(unset).not.toBeChecked();

    // System roles are never editable — no checkboxes in their columns.
    expect(screen.queryByRole('checkbox', { name: /OWNER/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /MEMBER/ })).not.toBeInTheDocument();

    // No save button until something changes.
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  });

  it('toggling a permission reveals Save and persists the full key set via updateRole', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('checkbox', { name: 'Toggle crm:contact:write for Sales manager' }));

    const save = await screen.findByRole('button', { name: 'Save' });
    fireEvent.click(save);

    await waitFor(() =>
      expect(updateRole).toHaveBeenCalledWith('role-1', {
        permissionKeys: ['crm:contact:read', 'crm:contact:write'],
      }),
    );
    // Success feedback + the save button disappears once the draft is flushed.
    await waitFor(() => expect(screen.getByText('Permissions saved.')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  });

  it('reverts unsaved changes without calling the API', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('checkbox', { name: 'Toggle crm:contact:write for Sales manager' }));
    await screen.findByRole('button', { name: 'Save' });

    fireEvent.click(screen.getByRole('button', { name: 'Revert' }));

    // Draft discarded: save button gone, checkbox back to saved state, no call.
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument());
    expect(screen.getByRole('checkbox', { name: 'Toggle crm:contact:write for Sales manager' })).not.toBeChecked();
    expect(updateRole).not.toHaveBeenCalled();
  });

  it('locks owner/admin-reserved permissions for custom roles (AUTHZ-4)', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());

    // The reserved row renders a locked marker, never a toggleable checkbox.
    expect(screen.getByTitle('Reserved for owner and admin roles')).toBeInTheDocument();
    expect(
      screen.queryByRole('checkbox', { name: 'Toggle platform:billing:manage for Sales manager' }),
    ).not.toBeInTheDocument();
  });

  it('deletes a custom role through the confirm dialog', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Delete Sales manager' }));

    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText('Delete "Sales manager"? Members assigned this role lose its permissions.'),
    ).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(deleteRole).toHaveBeenCalledWith('role-1'));
    await waitFor(() => expect(screen.getByText('Role deleted.')).toBeInTheDocument());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
