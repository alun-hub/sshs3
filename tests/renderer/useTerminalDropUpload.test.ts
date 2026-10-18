// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTerminalDropUpload, shellQuote } from '../../src/renderer/src/lib/useTerminalDropUpload';
import type { SSHConnectionConfig } from '../../src/shared/types/ssh';

describe('useTerminalDropUpload', () => {
  const sampleConfig: SSHConnectionConfig = {
    id: 'ssh-1',
    name: 'Server',
    host: 'server.example.com',
    port: 22,
    username: 'deploy',
    authType: 'password',
  };

  beforeEach(() => {
    window.multissh = {
      ...(window.multissh || {}),
      connectStorage: vi.fn().mockResolvedValue({ id: 'sftp-ssh-1' }),
      transferAdd: vi.fn().mockResolvedValue({ jobId: 'job-1' }),
    } as any;
  });

  describe('shellQuote', () => {
    it('wraps paths in single quotes and escapes single quotes inside', () => {
      expect(shellQuote('/var/log/syslog')).toBe("'/var/log/syslog'");
      expect(shellQuote("/path/with 'quotes'")).toBe("'/path/with '\\''quotes'\\'''");
    });
  });

  it('toggles isDragging on dragEnter and dragLeave', () => {
    const { result } = renderHook(() =>
      useTerminalDropUpload({
        isRemote: false,
        targetFolder: '/home/user',
        onPaste: vi.fn(),
        onNotice: vi.fn(),
      })
    );

    expect(result.current.isDragging).toBe(false);

    const fakeDragEnterEvent = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      dataTransfer: { types: ['Files'] },
    } as any;

    act(() => {
      result.current.dragHandlers.onDragEnter(fakeDragEnterEvent);
    });

    expect(result.current.isDragging).toBe(true);

    const fakeDragLeaveEvent = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as any;

    act(() => {
      result.current.dragHandlers.onDragLeave(fakeDragLeaveEvent);
    });

    expect(result.current.isDragging).toBe(false);
  });

  it('pastes local file paths directly when dropping in local session', async () => {
    const onPaste = vi.fn();
    const { result } = renderHook(() =>
      useTerminalDropUpload({
        isRemote: false,
        targetFolder: '/home/user',
        onPaste,
        onNotice: vi.fn(),
      })
    );

    const fakeFile = {
      name: 'report.pdf',
      path: '/home/user/Downloads/report.pdf',
    };

    const fakeDropEvent = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      dataTransfer: {
        files: [fakeFile],
      },
    } as any;

    await act(async () => {
      await result.current.dragHandlers.onDrop(fakeDropEvent);
    });

    expect(onPaste).toHaveBeenCalledWith("'/home/user/Downloads/report.pdf'");
  });

  it('uploads to remote CWD via SFTP and pastes remote path when dropping in SSH session', async () => {
    const onPaste = vi.fn();
    const onNotice = vi.fn();
    const { result } = renderHook(() =>
      useTerminalDropUpload({
        isRemote: true,
        config: sampleConfig,
        targetFolder: '/var/www/site',
        onPaste,
        onNotice,
      })
    );

    const fakeFile = {
      name: 'archive.tar.gz',
      path: '/home/user/Downloads/archive.tar.gz',
    };

    const fakeDropEvent = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      dataTransfer: {
        files: [fakeFile],
      },
    } as any;

    await act(async () => {
      await result.current.dragHandlers.onDrop(fakeDropEvent);
    });

    expect(window.multissh.connectStorage).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'sftp-ssh-1',
        type: 'sftp',
      })
    );

    expect(window.multissh.transferAdd).toHaveBeenCalledWith({
      sourceProviderId: 'local',
      sourcePath: '/home/user/Downloads/archive.tar.gz',
      targetProviderId: 'sftp-ssh-1',
      targetPath: '/var/www/site/archive.tar.gz',
    });

    expect(onNotice).toHaveBeenCalledWith('Uploaded archive.tar.gz');
    expect(onPaste).toHaveBeenCalledWith("'/var/www/site/archive.tar.gz'");
  });
});
