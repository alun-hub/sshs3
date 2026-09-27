// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MasterPasswordDialog } from '../../src/renderer/src/components/SettingsModal/MasterPasswordDialog';

describe('MasterPasswordDialog (LOW finding: weak master password gate)', () => {
  afterEach(() => cleanup());

  function renderSetup(onSubmit = vi.fn()) {
    render(
      <MasterPasswordDialog
        open={true}
        mode="setup"
        title="Set up sync"
        submitLabel="Enable"
        onCancel={vi.fn()}
        onSubmit={onSubmit}
      />
    );
    return onSubmit;
  }

  it('does not let a well-known weak password (>=8 chars) be submitted, once scored', async () => {
    renderSetup();

    fireEvent.change(screen.getByLabelText('Master password'), { target: { value: 'Password1!' } });
    fireEvent.change(screen.getByLabelText('Confirm master password'), { target: { value: 'Password1!' } });
    fireEvent.click(screen.getByLabelText(/saved these passwords somewhere safe/i));

    await waitFor(() => {
      expect(screen.getByText(/too easy to guess/i)).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: 'Enable' })).toBeDisabled();
  });

  it('allows submitting a long, unpredictable passphrase once scored', async () => {
    const onSubmit = renderSetup();

    const passphrase = 'correct-horse-battery-staple-9182-zephyr';
    fireEvent.change(screen.getByLabelText('Master password'), { target: { value: passphrase } });
    fireEvent.change(screen.getByLabelText('Confirm master password'), { target: { value: passphrase } });
    fireEvent.click(screen.getByLabelText(/saved these passwords somewhere safe/i));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Enable' })).not.toBeDisabled();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Enable' }));
    expect(onSubmit).toHaveBeenCalledWith(
      { topologyPassword: passphrase, credentialsPassword: passphrase },
      { linkSmartcard: false }
    );
  });

  it('still blocks a password under 8 characters regardless of zxcvbn score', () => {
    renderSetup();

    fireEvent.change(screen.getByLabelText('Master password'), { target: { value: 'a' } });
    fireEvent.change(screen.getByLabelText('Confirm master password'), { target: { value: 'a' } });
    fireEvent.click(screen.getByLabelText(/saved these passwords somewhere safe/i));

    expect(screen.getByRole('button', { name: 'Enable' })).toBeDisabled();
  });
});
