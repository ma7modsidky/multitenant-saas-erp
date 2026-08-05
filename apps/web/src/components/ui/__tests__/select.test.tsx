// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Select, SelectItem } from '../select';

function renderSelect(
  overrides: {
    value?: string;
    onValueChange?: (value: string) => void;
    placeholder?: string;
    disabled?: boolean;
    onChange?: (event: { target: { value: string; name?: string } }) => void;
  } = {},
) {
  const onValueChange = overrides.onValueChange ?? vi.fn();
  const utils = render(
    <Select
      value={overrides.value ?? 'stage-1'}
      onValueChange={onValueChange}
      aria-label="Stage"
      placeholder={overrides.placeholder}
      disabled={overrides.disabled}
      onChange={overrides.onChange}
    >
      <SelectItem value="stage-1">New</SelectItem>
      <SelectItem value="stage-2">Qualified</SelectItem>
      <SelectItem value="stage-3" disabled>
        Closed lost
      </SelectItem>
    </Select>,
  );
  return { onValueChange, ...utils };
}

describe('Select — custom themed dropdown', () => {
  it('renders a combobox trigger showing the selected option', () => {
    renderSelect();

    const trigger = screen.getByRole('combobox', { name: 'Stage' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'listbox');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveTextContent('New');
  });

  it('opens the popover on click, listing options with the selected one checked', () => {
    renderSelect();

    fireEvent.click(screen.getByRole('combobox', { name: 'Stage' }));

    expect(screen.getByRole('listbox', { name: 'Stage' })).toBeInTheDocument();
    const options = screen.getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['New', 'Qualified', 'Closed lost']);
    // The current option is aria-selected and carries a visible check.
    expect(screen.getByRole('option', { name: 'New' })).toHaveAttribute('aria-selected', 'true');
    const check = screen.getByRole('option', { name: 'New' }).querySelector('svg');
    expect(check).toHaveClass('opacity-100');
  });

  it('selects via click, calls onValueChange, and closes', async () => {
    const user = userEvent.setup();
    const { onValueChange } = renderSelect();

    await user.click(screen.getByRole('combobox', { name: 'Stage' }));
    await user.click(await screen.findByRole('option', { name: 'Qualified' }));

    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange).toHaveBeenCalledWith('stage-2');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('keeps disabled options unselectable', async () => {
    const user = userEvent.setup();
    const { onValueChange } = renderSelect();

    await user.click(screen.getByRole('combobox', { name: 'Stage' }));
    const lost = screen.getByRole('option', { name: 'Closed lost' });
    expect(lost).toBeDisabled();
    await user.click(lost);

    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('navigates with ArrowDown/Enter from the trigger', () => {
    const { onValueChange } = renderSelect();

    const trigger = screen.getByRole('combobox', { name: 'Stage' });
    fireEvent.keyDown(trigger, { key: 'ArrowDown' }); // open, active = New
    fireEvent.keyDown(trigger, { key: 'ArrowDown' }); // move to Qualified
    fireEvent.keyDown(trigger, { key: 'Enter' }); // select

    expect(onValueChange).toHaveBeenCalledWith('stage-2');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('closes on Escape and on an outside pointerdown', () => {
    renderSelect();

    const trigger = screen.getByRole('combobox', { name: 'Stage' });
    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    fireEvent.click(trigger);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('renders the placeholder as a disabled first option when there is no empty option', () => {
    render(
      <Select value="" onValueChange={vi.fn()} placeholder="Choose a role" aria-label="Role">
        <SelectItem value="role-admin">Admin</SelectItem>
      </Select>,
    );

    fireEvent.click(screen.getByRole('combobox', { name: 'Role' }));
    const placeholder = screen.getByRole('option', { name: 'Choose a role' });
    expect(placeholder).toBeDisabled();
    expect(placeholder).toHaveAttribute('aria-selected', 'true');
  });

  it('reports selections through a register-style onChange event (RHF compatibility)', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { onValueChange } = renderSelect({ onChange });

    await user.click(screen.getByRole('combobox', { name: 'Stage' }));
    await user.click(await screen.findByRole('option', { name: 'Qualified' }));

    expect(onChange).toHaveBeenCalledWith({ target: { value: 'stage-2' } });
    expect(onValueChange).toHaveBeenCalledWith('stage-2');
  });

  it('does not open when disabled', () => {
    renderSelect({ disabled: true });

    fireEvent.click(screen.getByRole('combobox', { name: 'Stage' }));
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});
