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

  const entry = (name: string, path: string) => ({ name, path, size: 1, isDirectory: false });
  const internalDrag = (providerId: string, entries: ReturnType<typeof entry>[]) => ({
    fromPane: 'left',
    providerId,
    basePath: '/',
    entries,
  });
  const dropWith = (payload: unknown) =>
    ({
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      dataTransfer: {
        getData: vi.fn((mime: string) =>
          mime === 'application/x-multissh-file-entries' ? JSON.stringify(payload) : ''
        ),
      },
    }) as any;

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
    window.multissh.getPathForFile = vi.fn().mockReturnValue('/home/user/Downloads/archive.tar.gz');

    const { result } = renderHook(() =>
      useTerminalDropUpload({
        isRemote: true,
        config: sampleConfig,
        targetFolder: '/var/www/site',
        onPaste,
        onNotice,
      })
    );

    // In modern Electron, DOM File has no .path property:
    const fakeFile = {
      name: 'archive.tar.gz',
    };

    const fakeDropEvent = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      dataTransfer: {
        files: [fakeFile],
        getData: vi.fn(),
      },
    } as any;

    await act(async () => {
      await result.current.dragHandlers.onDrop(fakeDropEvent);
    });

    expect(window.multissh.getPathForFile).toHaveBeenCalledWith(fakeFile);

    expect(window.multissh.connectStorage).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'local',
        type: 'local',
      })
    );

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

    expect(onNotice).toHaveBeenCalledWith('Uploading archive.tar.gz...');
    expect(onPaste).toHaveBeenCalledWith("'/var/www/site/archive.tar.gz'");
  });

  it('handles internal drag from sshs3 file manager on remote SSH host', async () => {
    const onPaste = vi.fn();
    const { result } = renderHook(() =>
      useTerminalDropUpload({
        isRemote: true,
        config: sampleConfig,
        targetFolder: '/var/www/site',
        onPaste,
        onNotice: vi.fn(),
      })
    );

    const internalPayload = internalDrag('sftp-ssh-1', [entry('app.log', '/var/log/app.log')]);

    const fakeDropEvent = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      dataTransfer: {
        getData: vi.fn((mime: string) =>
          mime === 'application/x-multissh-file-entries' ? JSON.stringify(internalPayload) : ''
        ),
      },
    } as any;

    await act(async () => {
      await result.current.dragHandlers.onDrop(fakeDropEvent);
    });

    expect(onPaste).toHaveBeenCalledWith("'/var/log/app.log'");
    expect(window.multissh.transferAdd).not.toHaveBeenCalled();
  });

  it('uploads internal drags from other providers and reports transfer errors', async () => {
    const onPaste = vi.fn();
    const onNotice = vi.fn();
    const { result } = renderHook(() =>
      useTerminalDropUpload({ isRemote: true, config: sampleConfig, targetFolder: '/srv', onPaste, onNotice })
    );

    await act(async () => {
      await result.current.dragHandlers.onDrop(dropWith(internalDrag('local', [entry('a.txt', '/tmp/a.txt')])));
    });
    expect(window.multissh.transferAdd).toHaveBeenCalledWith({
      sourceProviderId: 'local',
      sourcePath: '/tmp/a.txt',
      targetProviderId: 'sftp-ssh-1',
      targetPath: '/srv/a.txt',
    });
    expect(onPaste).toHaveBeenCalledWith("'/srv/a.txt'");

    onPaste.mockClear();
    (window.multissh.transferAdd as any).mockRejectedValueOnce(new Error('disk full'));
    await act(async () => {
      await result.current.dragHandlers.onDrop(dropWith(internalDrag('local', [entry('b.txt', '/tmp/b.txt')])));
    });
    expect(onNotice).toHaveBeenCalledWith('Upload failed: disk full');
    expect(onPaste).not.toHaveBeenCalled();
  });

  it('rejects malformed payloads and entry names that could escape the destination', async () => {
    const onPaste = vi.fn();
    const onNotice = vi.fn();
    const { result } = renderHook(() =>
      useTerminalDropUpload({ isRemote: true, config: sampleConfig, targetFolder: '/srv', onPaste, onNotice })
    );

    await act(async () => {
      await result.current.dragHandlers.onDrop(dropWith(internalDrag('local', [entry('../etc/passwd', '/tmp/x')])));
    });
    expect(onNotice).toHaveBeenCalledWith('Cannot drop files with unsupported names');
    expect(window.multissh.transferAdd).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.dragHandlers.onDrop(dropWith({ providerId: 'local', entries: [{ name: 'a', path: '/a' }] }));
    });
    expect(window.multissh.transferAdd).not.toHaveBeenCalled();
    expect(onPaste).not.toHaveBeenCalled();
  });

  it('tells the user when remote files are dropped into a local terminal', async () => {
    const onPaste = vi.fn();
    const onNotice = vi.fn();
    const { result } = renderHook(() =>
      useTerminalDropUpload({ isRemote: false, targetFolder: '', onPaste, onNotice })
    );

    await act(async () => {
      await result.current.dragHandlers.onDrop(dropWith(internalDrag('sftp-x', [entry('a', '/a')])));
    });
    expect(onNotice).toHaveBeenCalledWith(expect.stringContaining('copy them to the local disk'));
    expect(onPaste).not.toHaveBeenCalled();
  });

  it('uploads into the container for Kubernetes terminals', async () => {
    const onPaste = vi.fn();
    const k8sTarget = { contextName: 'c', namespace: 'n', podName: 'p', containerName: 'x' };
    const { result } = renderHook(() =>
      useTerminalDropUpload({ isRemote: false, k8sTarget, targetFolder: '/app', onPaste, onNotice: vi.fn() })
    );

    await act(async () => {
      await result.current.dragHandlers.onDrop(dropWith(internalDrag('local', [entry('a.txt', '/tmp/a.txt')])));
    });
    expect(window.multissh.transferAdd).toHaveBeenCalledWith(
      expect.objectContaining({ targetProviderId: 'k8s-c/n/p/x', targetPath: '/app/a.txt' })
    );
    expect(onPaste).toHaveBeenCalledWith("'/app/a.txt'");
  });
});
