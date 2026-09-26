// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { DirSyncSavedProfilesModal } from '../../src/renderer/src/components/FileManager/DirSyncSavedProfilesModal';
import type { DirectorySyncProfile } from '../../src/shared/types/dirsync';
import type { SSHConnectionConfig } from '../../src/shared/types/ssh';

const mockSsh: SSHConnectionConfig[] = [
  {
    id: 'ssh-remote-1',
    name: 'Production Web',
    host: 'web.prod.com',
    port: 22,
    username: 'admin',
    authType: 'password',
  },
];

const mockProfiles: DirectorySyncProfile[] = [
  {
    id: 'sync-1',
    name: 'Web Server to Local Backup',
    source: { providerConfigRef: 'sftp-ssh-remote-1', path: '/var/www/html' },
    target: { providerConfigRef: 'local', path: '/home/alun/backups' },
    deleteExtraneous: true,
    createdAt: '2026-09-26T12:00:00.000Z',
    updatedAt: '2026-09-26T12:00:00.000Z',
    lastRunAt: '2026-09-26T14:30:00.000Z',
  },
];

describe('DirSyncSavedProfilesModal', () => {
  beforeEach(() => {
    window.multissh = {
      dirSyncProfileList: vi.fn().mockResolvedValue(mockProfiles),
      dirSyncProfileDelete: vi.fn().mockResolvedValue(undefined),
      profilesGet: vi.fn().mockResolvedValue({ ssh: mockSsh, s3: [] }),
    } as any;
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders clearly showing source host, target host and transfer direction', async () => {
    render(<DirSyncSavedProfilesModal open={true} onClose={() => {}} onRun={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText('Web Server to Local Backup')).toBeInTheDocument();
    });

    // Check Source (From) info
    expect(screen.getByText('Source (From)')).toBeInTheDocument();
    expect(screen.getByText('Production Web')).toBeInTheDocument();
    expect(screen.getByText('SFTP · admin@web.prod.com')).toBeInTheDocument();
    expect(screen.getByText('/var/www/html')).toBeInTheDocument();

    // Check Direction indicator
    expect(screen.getByText('Syncs to')).toBeInTheDocument();

    // Check Target (To) info
    expect(screen.getByText('Target (To)')).toBeInTheDocument();
    expect(screen.getByText('Local Disk')).toBeInTheDocument();
    expect(screen.getByText('This computer (Local)')).toBeInTheDocument();
    expect(screen.getByText('/home/alun/backups')).toBeInTheDocument();

    // Check Mirror warning
    expect(screen.getByText(/Mirror: Files in target missing from source will be deleted/)).toBeInTheDocument();
  });
});
