// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { FilePane } from '../../src/renderer/src/components/FileManager/FilePane';
import { DragDropProvider } from '../../src/renderer/src/components/FileManager/DragDropLayer';
import { ConfirmProvider } from '../../src/renderer/src/components/ConfirmDialog';

describe('FilePane Home Button', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (window as any).multissh = {
      storageList: vi.fn().mockResolvedValue([]),
      getHomeDir: vi.fn().mockResolvedValue('/home/localuser'),
      storageGetHomeDir: vi.fn().mockResolvedValue('/home/remoteuser'),
      onTransferProgress: vi.fn().mockReturnValue(() => {}),
      onSearchResult: vi.fn().mockReturnValue(() => {}),
      onSearchProgress: vi.fn().mockReturnValue(() => {}),
      onSearchError: vi.fn().mockReturnValue(() => {}),
      onSearchDone: vi.fn().mockReturnValue(() => {}),
    };
  });

  it('renders Home button for local storage and navigates to local home on click', async () => {
    const onPathChange = vi.fn();
    render(
      <ConfirmProvider>
        <DragDropProvider>
        <FilePane
          side="left"
          source={{ providerId: 'local', sourceType: 'local', label: 'Local Disk' }}
          currentPath="/var/log"
          onPathChange={onPathChange}
          onSourceTypeRequest={vi.fn()}
          onTransferRequested={vi.fn()}
          refreshToken={0}
        />
        </DragDropProvider>
      </ConfirmProvider>
    );

    const homeBtn = screen.getByRole('button', { name: 'Home' });
    expect(homeBtn).toBeInTheDocument();

    fireEvent.click(homeBtn);
    await waitFor(() => {
      expect(onPathChange).toHaveBeenCalledWith('/home/localuser');
    });
  });

  it('renders Home button for sftp storage and navigates to remote home on click', async () => {
    const onPathChange = vi.fn();
    render(
      <ConfirmProvider>
        <DragDropProvider>
        <FilePane
          side="right"
          source={{ providerId: 'sftp-1', sourceType: 'sftp', label: 'My SFTP' }}
          currentPath="/etc/nginx"
          onPathChange={onPathChange}
          onSourceTypeRequest={vi.fn()}
          onTransferRequested={vi.fn()}
          refreshToken={0}
        />
        </DragDropProvider>
      </ConfirmProvider>
    );

    const homeBtn = screen.getByRole('button', { name: 'Home' });
    expect(homeBtn).toBeInTheDocument();

    fireEvent.click(homeBtn);
    await waitFor(() => {
      expect((window as any).multissh.storageGetHomeDir).toHaveBeenCalledWith('sftp-1');
      expect(onPathChange).toHaveBeenCalledWith('/home/remoteuser');
    });
  });

  it('does NOT render Home button for s3 storage', () => {
    render(
      <ConfirmProvider>
        <DragDropProvider>
        <FilePane
          side="right"
          source={{ providerId: 's3-1', sourceType: 's3', label: 'My S3' }}
          currentPath="/my-bucket"
          onPathChange={vi.fn()}
          onSourceTypeRequest={vi.fn()}
          onTransferRequested={vi.fn()}
          refreshToken={0}
        />
        </DragDropProvider>
      </ConfirmProvider>
    );

    expect(screen.queryByRole('button', { name: 'Home' })).not.toBeInTheDocument();
  });

  it('does NOT render Home button for k8s storage', () => {
    render(
      <ConfirmProvider>
        <DragDropProvider>
        <FilePane
          side="right"
          source={{ providerId: 'k8s-1', sourceType: 'k8s', label: 'My Pod' }}
          currentPath="/"
          onPathChange={vi.fn()}
          onSourceTypeRequest={vi.fn()}
          onTransferRequested={vi.fn()}
          refreshToken={0}
        />
        </DragDropProvider>
      </ConfirmProvider>
    );

    expect(screen.queryByRole('button', { name: 'Home' })).not.toBeInTheDocument();
  });

  it('does NOT reload folder or clear selection when isActive or callback references change', async () => {
    const storageListMock = vi.fn().mockResolvedValue([
      { name: 'file1.txt', path: '/var/log/file1.txt', size: 100, isDirectory: false },
    ]);
    (window as any).multissh.storageList = storageListMock;

    const { rerender } = render(
      <ConfirmProvider>
        <DragDropProvider>
          <FilePane
            side="right"
            source={{ providerId: 'local', sourceType: 'local', label: 'Local Disk' }}
            currentPath="/var/log"
            isActive={false}
            onPathChange={() => {}}
            onSourceTypeRequest={vi.fn()}
            onTransferRequested={vi.fn()}
            refreshToken={0}
          />
        </DragDropProvider>
      </ConfirmProvider>
    );

    await waitFor(() => {
      expect(storageListMock).toHaveBeenCalledTimes(1);
    });

    // Re-render with isActive=true and a new inline function reference for onPathChange
    rerender(
      <ConfirmProvider>
        <DragDropProvider>
          <FilePane
            side="right"
            source={{ providerId: 'local', sourceType: 'local', label: 'Local Disk' }}
            currentPath="/var/log"
            isActive={true}
            onPathChange={() => {}}
            onSourceTypeRequest={vi.fn()}
            onTransferRequested={vi.fn()}
            refreshToken={0}
          />
        </DragDropProvider>
      </ConfirmProvider>
    );

    // storageList should STILL have only been called once (no redundant reload that resets scroll)
    expect(storageListMock).toHaveBeenCalledTimes(1);
  });
});
