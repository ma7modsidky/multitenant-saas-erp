// @vitest-environment jsdom

import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfirmDialog } from '../confirm-dialog';

const baseProps = {
  open: true,
  title: 'Remove member',
  description: 'Remove Jane from this organization?',
  confirmLabel: 'Delete',
  cancelLabel: 'Cancel',
  closeLabel: 'Close',
  onConfirm: vi.fn(),
  onCancel: vi.fn(),
};

describe('ConfirmDialog', () => {
  // The mocks are shared module-scope vi.fn()s — without clearing, call counts
  // accumulate across tests and toHaveBeenCalledTimes assertions go stale.
  beforeEach(() => {
    baseProps.onConfirm.mockClear();
    baseProps.onCancel.mockClear();
  });

  it('renders nothing while closed', () => {
    render(<ConfirmDialog {...baseProps} open={false} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders title, description, and both actions when open', () => {
    render(<ConfirmDialog {...baseProps} />);

    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByText('Remove member')).toBeInTheDocument();
    expect(dialog.getByText('Remove Jane from this organization?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('calls onConfirm when the confirm button is clicked', () => {
    render(<ConfirmDialog {...baseProps} />);

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(baseProps.onConfirm).toHaveBeenCalledTimes(1);
    expect(baseProps.onCancel).not.toHaveBeenCalled();
  });

  it('calls onCancel when the footer Cancel button is clicked', () => {
    render(<ConfirmDialog {...baseProps} />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(baseProps.onCancel).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when the backdrop is clicked (but stays a11y-invisible)', () => {
    render(<ConfirmDialog {...baseProps} />);

    const backdrop = screen.getByTestId('confirm-dialog-backdrop');
    // The backdrop is a visual dismissal surface only — it must not expose an
    // accessible name (the footer Cancel button owns the "Cancel" label), so
    // it can never collide with getByRole queries or confuse screen readers.
    expect(backdrop).toHaveAttribute('aria-hidden', 'true');
    fireEvent.click(backdrop);
    expect(baseProps.onCancel).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape', () => {
    render(<ConfirmDialog {...baseProps} />);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(baseProps.onCancel).toHaveBeenCalledTimes(1);
  });

  it('disables both buttons while loading so the action cannot be double-fired', () => {
    render(<ConfirmDialog {...baseProps} loading />);

    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(baseProps.onConfirm).not.toHaveBeenCalled();
  });

  it('uses a destructive-styled confirm button when destructive is set', () => {
    render(<ConfirmDialog {...baseProps} destructive />);

    const confirm = screen.getByRole('button', { name: 'Delete' });
    // The destructive variant carries the destructive color classes.
    expect(confirm.className).toContain('destructive');
  });
});
