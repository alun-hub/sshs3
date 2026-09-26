// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { SSHProfileForm } from '../../src/renderer/src/components/ConnectionModal/SSHProfileForm';
import type { SSHConnectionConfig } from '../../src/shared/types/ssh';

describe('SSHProfileForm', () => {
  beforeEach(() => {
    window.multissh = {
      dotfilePoolsGet: vi.fn().mockResolvedValue([]),
      smartcardDetect: vi.fn().mockResolvedValue([]),
      testSSHConnection: vi.fn().mockResolvedValue({ success: true }),
      selectFile: vi.fn().mockResolvedValue(null),
    } as unknown as typeof window.multissh;
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders and allows toggling Forward SSH Agent checkbox under Advanced Options', async () => {
    const onSave = vi.fn();
    const initialConfig: SSHConnectionConfig = {
      id: 'test-1',
      name: 'Bastion Host',
      host: 'bastion.example.com',
      port: 22,
      username: 'admin',
      authType: 'password',
      password: 'secretpassword',
    };

    render(
      <SSHProfileForm
        initial={initialConfig}
        onSave={onSave}
        onCancel={vi.fn()}
      />
    );

    // Expand Advanced Options
    const advancedBtn = screen.getByRole('button', { name: /Advanced SSH Options/i });
    fireEvent.click(advancedBtn);

    // Checkbox for Forward SSH Agent
    const forwardAgentCheckbox = screen.getByLabelText(/Forward SSH Agent/i) as HTMLInputElement;
    expect(forwardAgentCheckbox).toBeInTheDocument();
    expect(forwardAgentCheckbox.checked).toBe(false);

    // Toggle Forward SSH Agent
    fireEvent.click(forwardAgentCheckbox);
    expect(forwardAgentCheckbox.checked).toBe(true);

    // Submit form
    const saveBtn = screen.getByRole('button', { name: /Save Profile/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'test-1',
          name: 'Bastion Host',
          host: 'bastion.example.com',
          username: 'admin',
          forwardAgent: true,
        })
      );
    });
  });

  it('initializes Forward SSH Agent checkbox as checked if forwardAgent is true in initial config', () => {
    const initialConfig: SSHConnectionConfig = {
      id: 'test-2',
      name: 'Jump Host',
      host: 'jump.example.com',
      port: 22,
      username: 'dev',
      authType: 'password',
      forwardAgent: true,
    };

    render(
      <SSHProfileForm
        initial={initialConfig}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    // Expand Advanced Options
    const advancedBtn = screen.getByRole('button', { name: /Advanced SSH Options/i });
    fireEvent.click(advancedBtn);

    const forwardAgentCheckbox = screen.getByLabelText(/Forward SSH Agent/i) as HTMLInputElement;
    expect(forwardAgentCheckbox.checked).toBe(true);
  });

  it('renders and allows toggling Forward X11 GUI checkbox and setting display location', async () => {
    (window.multissh as any).checkX11Server = vi.fn().mockResolvedValue({ running: true, display: '127.0.0.1:0.0' });
    const onSave = vi.fn();
    const initialConfig: SSHConnectionConfig = {
      id: 'test-x11',
      name: 'GUI Host',
      host: 'gui.example.com',
      port: 22,
      username: 'admin',
      authType: 'password',
    };

    render(
      <SSHProfileForm
        initial={initialConfig}
        onSave={onSave}
        onCancel={vi.fn()}
      />
    );

    // Expand Advanced Options
    const advancedBtn = screen.getByRole('button', { name: /Advanced SSH Options/i });
    fireEvent.click(advancedBtn);

    // Checkbox for Forward X11 GUI
    const x11Checkbox = screen.getByLabelText(/Forward X11 GUI/i) as HTMLInputElement;
    expect(x11Checkbox).toBeInTheDocument();
    expect(x11Checkbox.checked).toBe(false);

    // Toggle Forward X11 GUI
    fireEvent.click(x11Checkbox);
    expect(x11Checkbox.checked).toBe(true);

    // Display location input appears
    const displayInput = screen.getByPlaceholderText('127.0.0.1:0.0') as HTMLInputElement;
    expect(displayInput).toBeInTheDocument();
    fireEvent.change(displayInput, { target: { value: 'localhost:0.0' } });

    // Submit form
    const saveBtn = screen.getByRole('button', { name: /Save Profile/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'test-x11',
          name: 'GUI Host',
          x11Forwarding: true,
          x11Display: 'localhost:0.0',
        })
      );
    });
  });

  it('offers an overwrite retry when generating a FIDO2 key hits a stale local file, even through Electron\'s wrapped error message', async () => {
    const fido2GenerateKey = vi
      .fn()
      .mockRejectedValueOnce(
        new Error(
          "Error invoking remote method 'fido2:generate-key': Error: FIDO2_KEY_FILE_EXISTS: A file already exists at /home/alun/.ssh/id_ed25519_sk."
        )
      )
      .mockResolvedValueOnce({
        publicKey: 'sk-ssh-ed25519@openssh.com AAAA...',
        privateKeyPath: '/home/alun/.ssh/id_ed25519_sk',
        publicKeyPath: '/home/alun/.ssh/id_ed25519_sk.pub',
      });
    window.multissh = {
      ...window.multissh,
      fido2GenerateKey,
      fido2ListResidentKeys: vi.fn().mockResolvedValue([]),
    } as unknown as typeof window.multissh;

    const initialConfig: SSHConnectionConfig = {
      id: 'test-fido2',
      name: 'Fido2 Host',
      host: 'fido2.example.com',
      port: 22,
      username: 'admin',
      authType: 'fido2',
      fido2Resident: true,
    };

    render(<SSHProfileForm initial={initialConfig} onSave={vi.fn()} onCancel={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /Generate a new key on this security key/i }));
    fireEvent.click(screen.getByRole('button', { name: /^Generate Key$/i }));

    await waitFor(() => {
      expect(screen.getByText(/A file already exists at \/home\/alun\/\.ssh\/id_ed25519_sk\./)).toBeInTheDocument();
    });
    const overwriteBtn = screen.getByRole('button', { name: /Overwrite/i });
    expect(overwriteBtn).toBeInTheDocument();

    fireEvent.click(overwriteBtn);

    await waitFor(() => {
      expect(fido2GenerateKey).toHaveBeenLastCalledWith(expect.objectContaining({ overwrite: true }));
    });
  });
});
