// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { SshCaSettingsPanel } from '../../src/renderer/src/components/SettingsModal/SshCaSettingsPanel';
import type { SettingsForm } from '../../src/renderer/src/components/SettingsModal/useSettingsForm';
import type { SshCaConfig } from '../../src/shared/types/sshCa';

describe('SshCaSettingsPanel', () => {
  let configs: SshCaConfig[];
  let defaultId: string | undefined;
  const mockSetConfigs = vi.fn((newConfigs) => {
    configs = newConfigs;
  });
  const mockSetDefaultId = vi.fn((id) => {
    defaultId = id;
  });

  const mockLogin = vi.fn();

  beforeEach(() => {
    configs = [];
    defaultId = undefined;
    vi.clearAllMocks();

    window.sshs3 = {
      ...window.sshs3,
      sshCaGetStatus: vi.fn().mockResolvedValue({ active: false }),
      onSshCaStatusChanged: vi.fn().mockReturnValue(() => {}),
      sshCaLogin: mockLogin,
      sshCaLogout: vi.fn().mockResolvedValue(undefined),
      sshCaRenew: vi.fn().mockResolvedValue({ active: true }),
    } as any;
  });

  const createMockForm = (overrides: Partial<SettingsForm> = {}): SettingsForm => {
    return {
      sshCaConfigs: configs,
      setSshCaConfigs: mockSetConfigs,
      defaultSshCaConfigId: defaultId,
      setDefaultSshCaConfigId: mockSetDefaultId,
      ...overrides,
    } as unknown as SettingsForm;
  };

  it('renders empty placeholder when no CAs configured', () => {
    render(<SshCaSettingsPanel form={createMockForm()} />);
    expect(
      screen.getByText(/No SSH Certificate Authorities configured yet/i)
    ).toBeInTheDocument();
  });

  it('opens add form, creates new CA configuration, and saves', () => {
    render(<SshCaSettingsPanel form={createMockForm()} />);

    fireEvent.click(screen.getByTestId('add-ssh-ca-btn'));
    expect(screen.getByText('New SSH CA')).toBeInTheDocument();

    const nameInput = screen.getByPlaceholderText('Step-CA Internal');
    fireEvent.change(nameInput, { target: { value: 'Production Step-CA' } });

    const caUrlInput = screen.getByPlaceholderText('https://ca.example.com:30900');
    fireEvent.change(caUrlInput, { target: { value: 'https://ca.prod.corp:30900' } });

    const oidcUrlInput = screen.getByPlaceholderText('https://keycloak.example.com/realms/sshca');
    fireEvent.change(oidcUrlInput, { target: { value: 'https://idp.prod.corp/realms/ssh' } });

    fireEvent.click(screen.getByText('Save Configuration'));

    expect(mockSetConfigs).toHaveBeenCalledTimes(1);
    const saved = mockSetConfigs.mock.calls[0][0];
    expect(saved[0].name).toBe('Production Step-CA');
    expect(saved[0].caUrl).toBe('https://ca.prod.corp:30900');
    expect(mockSetDefaultId).toHaveBeenCalledWith(saved[0].id);
  });

  it('renders configured CA and triggers authentication test', async () => {
    const existing: SshCaConfig = {
      id: 'ca-1',
      name: 'Corporate Step-CA',
      backend: 'step-ca',
      caUrl: 'https://ca.corp:30900',
      oidcIssuerUrl: 'https://idp.corp/realms/ssh',
      oidcClientId: 'step-ca',
      keySource: 'ephemeral',
      defaultPrincipals: ['admin'],
    };
    configs = [existing];
    defaultId = 'ca-1';

    mockLogin.mockResolvedValueOnce({
      active: true,
      username: 'alun',
    });

    render(<SshCaSettingsPanel form={createMockForm()} />);

    expect(screen.getByText('Corporate Step-CA')).toBeInTheDocument();
    expect(screen.getByText('Default')).toBeInTheDocument();

    const authBtn = screen.getByText('Authenticate with CA');
    fireEvent.click(authBtn);

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith(existing);
      expect(screen.getByText(/Successfully authenticated as alun/i)).toBeInTheDocument();
    });
  });

  it('deletes an existing CA configuration', () => {
    const existing: SshCaConfig = {
      id: 'ca-1',
      name: 'To Delete',
      backend: 'step-ca',
      caUrl: 'https://ca.example.com',
      oidcIssuerUrl: 'https://idp.example.com',
      oidcClientId: 'step-ca',
      keySource: 'ephemeral',
    };
    configs = [existing];

    render(<SshCaSettingsPanel form={createMockForm()} />);

    const deleteBtn = screen.getByLabelText('Delete');
    fireEvent.click(deleteBtn);

    expect(mockSetConfigs).toHaveBeenCalledWith([]);
  });
});
