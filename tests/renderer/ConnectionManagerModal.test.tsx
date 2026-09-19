// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ConnectionManagerModal } from '../../src/renderer/src/components/ConnectionModal/ConnectionManagerModal';
import type { SSHConnectionConfig } from '../../src/shared/types/ssh';
import type { S3Config } from '../../src/shared/types/storage';

const mockSSHProfiles: SSHConnectionConfig[] = [
  {
    id: 'ssh-1',
    name: 'Prod Web 01',
    host: 'web01.prod.example.com',
    port: 22,
    username: 'deploy',
    authType: 'password',
    group: 'Produktion',
    lastUsedAt: '2026-09-16 12:30',
  },
  {
    id: 'ssh-2',
    name: 'Prod DB 01',
    host: 'db01.prod.example.com',
    port: 2222,
    username: 'postgres',
    authType: 'password',
    group: 'Produktion',
    forwardAgent: true,
  },
  {
    id: 'ssh-3',
    name: 'Dev Sandbox',
    host: 'sandbox.dev.example.com',
    port: 22,
    username: 'ubuntu',
    authType: 'password',
    group: 'Utveckling',
  },
];

const mockS3Profiles: S3Config[] = [
  {
    id: 's3-1',
    name: 'Backup Bucket',
    region: 'eu-north-1',
    accessKeyId: 'test-key',
    secretAccessKey: 'test-secret',
    group: 'Backuper',
    lastUsedAt: '2026-09-15 09:15',
  },
];

describe('ConnectionManagerModal', () => {
  beforeEach(() => {
    window.multissh = {
      profilesGet: vi.fn().mockResolvedValue({
        ssh: mockSSHProfiles,
        s3: mockS3Profiles,
      }),
      profilesSaveSSH: vi.fn().mockResolvedValue(undefined),
      profilesSaveS3: vi.fn().mockResolvedValue(undefined),
      profilesDeleteSSH: vi.fn().mockResolvedValue(undefined),
      profilesDeleteS3: vi.fn().mockResolvedValue(undefined),
    } as unknown as typeof window.multissh;
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('does not render when open is false', () => {
    const { container } = render(
      <ConnectionManagerModal open={false} onClose={vi.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders profile groups and recently used section for SSH', async () => {
    render(
      <ConnectionManagerModal
        open={true}
        onClose={vi.fn()}
        onConnectSSH={vi.fn()}
      />
    );

    // Verify recent section
    await waitFor(() => {
      expect(screen.getByText('Recently Used')).toBeInTheDocument();
    });
    expect(screen.getByText(/Last connected: 2026-09-16 12:30/)).toBeInTheDocument();

    // Verify folders / groups with count badges
    expect(screen.getAllByText('Produktion').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Utveckling')).toBeInTheDocument();

    // Verify profiles rendered
    expect(screen.getAllByText('Prod Web 01').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Prod DB 01')).toBeInTheDocument();
    expect(screen.getByText('Agent Fwd')).toBeInTheDocument();
    expect(screen.getByText('Dev Sandbox')).toBeInTheDocument();
  });

  it('filters profiles and groups based on search query', async () => {
    render(
      <ConnectionManagerModal
        open={true}
        onClose={vi.fn()}
        onConnectSSH={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Dev Sandbox')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText('Search profiles or folders...');
    fireEvent.change(searchInput, { target: { value: 'sandbox' } });

    // Sandbox should remain, Prod should be filtered out
    expect(screen.getByText('Dev Sandbox')).toBeInTheDocument();
    expect(screen.queryByText('Prod Web 01')).not.toBeInTheDocument();
    expect(screen.queryByText('Prod DB 01')).not.toBeInTheDocument();

    // Search query also suppresses the recently used section
    expect(screen.queryByText('Recently Used')).not.toBeInTheDocument();
  });

  it('allows collapsing and expanding a group folder', async () => {
    render(
      <ConnectionManagerModal
        open={true}
        onClose={vi.fn()}
        onConnectSSH={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Prod DB 01')).toBeInTheDocument();
    });

    // Click "Produktion" folder header to collapse (folder header button containing 'Produktion')
    const groupHeader = screen.getByRole('button', { name: /Produktion/ });
    fireEvent.click(groupHeader);

    // Items inside group should now be collapsed/hidden
    expect(screen.queryByText('Prod DB 01')).not.toBeInTheDocument();

    // Click again to expand
    fireEvent.click(groupHeader);
    expect(screen.getByText('Prod DB 01')).toBeInTheDocument();
  });

  it('calls onConnectSSH with updated timestamp when Connect is clicked', async () => {
    const onConnectSSH = vi.fn();
    render(
      <ConnectionManagerModal
        open={true}
        onClose={vi.fn()}
        onConnectSSH={onConnectSSH}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Dev Sandbox')).toBeInTheDocument();
    });

    // Find the connect button for Dev Sandbox
    const connectButtons = screen.getAllByRole('button', { name: 'Connect' });
    expect(connectButtons.length).toBeGreaterThan(0);

    fireEvent.click(connectButtons[connectButtons.length - 1]);

    await waitFor(() => {
      expect(window.multissh.profilesSaveSSH).toHaveBeenCalled();
      expect(onConnectSSH).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'ssh-3',
          name: 'Dev Sandbox',
          lastUsedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/),
        })
      );
    });
  });

  it('switches to S3 tab and displays S3 profiles and groups', async () => {
    render(
      <ConnectionManagerModal
        open={true}
        onClose={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Dev Sandbox')).toBeInTheDocument();
    });

    // Switch to S3 tab
    const s3TabButton = screen.getByRole('button', { name: /S3/i });
    fireEvent.click(s3TabButton);

    await waitFor(() => {
      expect(screen.getAllByText('Backup Bucket').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Backuper').length).toBeGreaterThanOrEqual(1);
    });
  });
});
