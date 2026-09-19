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
});
