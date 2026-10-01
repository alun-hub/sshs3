// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { DualPaneExplorer } from '../../src/renderer/src/components/FileManager/DualPaneExplorer';
import { ConfirmProvider } from '../../src/renderer/src/components/ConfirmDialog';
import type { SSHConnectionConfig } from '../../src/shared/types/ssh';

describe('DualPaneExplorer SFTP default start path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (window as any).multissh = {
      connectStorage: vi.fn().mockResolvedValue({ id: 's1' }),
      storageList: vi.fn().mockResolvedValue([]),
      getHomeDir: vi.fn().mockResolvedValue('/home/localuser'),
      storageGetHomeDir: vi.fn().mockResolvedValue('/home/user'),
      sessionGet: vi.fn().mockResolvedValue(null),
      sessionSave: vi.fn().mockResolvedValue(undefined),
      profilesGet: vi.fn().mockResolvedValue({ ssh: [], s3: [] }),
      transferGetJobs: vi.fn().mockResolvedValue([]),
      onTransferProgress: vi.fn().mockReturnValue(() => {}),
      onSearchResult: vi.fn().mockReturnValue(() => {}),
      onSearchProgress: vi.fn().mockReturnValue(() => {}),
      onSearchError: vi.fn().mockReturnValue(() => {}),
      onSearchDone: vi.fn().mockReturnValue(() => {}),
    };
  });

  it('starts at /home/user (or resolved remote home) by default when initialSSHConfig has no initialPath', async () => {
    const config: SSHConnectionConfig = {
      id: 'test-profile-1',
      name: 'Production Server',
      host: 'prod.example.com',
      port: 22,
      username: 'user',
      authType: 'agent',
    };

    render(
      <ConfirmProvider>
        <DualPaneExplorer initialSSHConfig={config} />
      </ConfirmProvider>
    );

    await waitFor(() => {
      expect((window as any).multissh.connectStorage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'sftp',
          id: 'sftp-test-profile-1',
        })
      );
      expect((window as any).multissh.storageGetHomeDir).toHaveBeenCalledWith('sftp-test-profile-1');
    });

    // The right pane should have navigated to /home/user, so /home/user segments appear
    await waitFor(() => {
      expect(screen.getAllByText('user').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('starts at explicit initialPath when provided in profile', async () => {
    const config: SSHConnectionConfig = {
      id: 'test-profile-2',
      name: 'Web Server',
      host: 'web.example.com',
      port: 22,
      username: 'deploy',
      authType: 'agent',
      initialPath: '/var/www/html',
    };

    render(
      <ConfirmProvider>
        <DualPaneExplorer initialSSHConfig={config} />
      </ConfirmProvider>
    );

    await waitFor(() => {
      expect((window as any).multissh.connectStorage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'sftp',
          id: 'sftp-test-profile-2',
        })
      );
    });

    await waitFor(() => {
      expect(screen.getByText('html')).toBeInTheDocument();
    });
  });
});
