// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { FileEntry } from '@shared/types/storage';
import type { PathClickAction } from './pathOpenDecision';
import { useTerminalPathHover, type UseTerminalPathHoverOptions } from './useTerminalPathHover';

type Api = Record<string, unknown>;

interface SetupOptions {
  target?: UseTerminalPathHoverOptions['target'];
  pathClickAction?: PathClickAction;
  onOpenPath?: (path: string) => void;
  sessionId?: string | null;
}

function setup(api: Api, options: SetupOptions = {}) {
  (window as unknown as { multissh: Api }).multissh = api;
  const notify = vi.fn();
  const hook = renderHook(() =>
    useTerminalPathHover({
      target: options.target ?? { local: true },
      pathHoverPreview: true,
      pathClickAction: options.pathClickAction,
      onOpenPath: options.onOpenPath,
      termRef: { current: null },
      sessionIdRef: { current: options.sessionId ?? null },
      notify,
    })
  );
  const handlers = hook.result.current.createLinkHandlers();
  const hover = async (path: string) => {
    await act(async () => {
      handlers.hoverPath?.({ clientX: 10, clientY: 10, ctrlKey: false, metaKey: false } as MouseEvent, path);
      await vi.advanceTimersByTimeAsync(700);
    });
  };
  /** Ctrl+click: starts the handler and returns its promise, so a test can click again before it settles. */
  // The link handler type says `void`, but the handler is async.
  const click = (path: string) => handlers.openPath!(path) as unknown as Promise<void>;
  return { hook, notify, hover, click };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete (window as unknown as { multissh?: Api }).multissh;
});

describe('useTerminalPathHover: existence gate after a failed connect', () => {
  it('shows the card while the connection is down, then hides it for a missing file once it works', async () => {
    const connectStorage = vi
      .fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValue(undefined);
    const { hook, hover } = setup({
      connectStorage,
      storageLookup: vi.fn().mockResolvedValue(null), // the file does not exist
    });

    // Connection failed: a miss is inconclusive, so the card is shown as before.
    await hover('/srv/missing/one.ts');
    expect(hook.result.current.hoverCardData?.path).toBe('/srv/missing/one.ts');

    // After the retry back-off the connection succeeds; a miss now means the file is really missing.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(31_000);
    });
    await hover('/srv/missing/two.ts');
    expect(connectStorage).toHaveBeenCalledTimes(2);
    expect(hook.result.current.hoverCardData?.path).not.toBe('/srv/missing/two.ts');
  });
});

describe('useTerminalPathHover: onCopyPath', () => {
  const copy = async (writeText: ((t: string) => Promise<void>) | undefined) => {
    Object.defineProperty(navigator, 'clipboard', { value: writeText ? { writeText } : undefined, configurable: true });
    const { hook, notify } = setup({});
    await act(async () => {
      hook.result.current.cardProps.onCopyPath('/etc/hosts');
    });
    return { hook, notify };
  };

  it('reports success only after the clipboard accepted the text', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const { notify } = await copy(writeText);
    expect(writeText).toHaveBeenCalledWith('/etc/hosts');
    expect(notify).toHaveBeenCalledWith('Copied path: /etc/hosts', 2000);
  });

  it('reports a failure when the clipboard rejects, without an unhandled rejection', async () => {
    const { notify } = await copy(vi.fn().mockRejectedValue(new Error('denied')));
    expect(notify).toHaveBeenCalledWith('Failed to copy path', 3000);
    expect(notify).not.toHaveBeenCalledWith(expect.stringContaining('Copied'), expect.anything());
  });

  it('reports a failure when there is no clipboard', async () => {
    const { notify } = await copy(undefined);
    expect(notify).toHaveBeenCalledWith('Failed to copy path', 3000);
  });
});

describe('useTerminalPathHover: Ctrl+click on a path', () => {
  const entry = (over: Partial<FileEntry> = {}): FileEntry => ({
    name: 'hosts',
    path: '/etc/hosts',
    size: 100,
    isDirectory: false,
    permissions: '644',
    ...over,
  });
  const remoteTarget = { config: { id: 'h', host: 'h', username: 'u' } } as UseTerminalPathHoverOptions['target'];

  const api = (over: Api = {}) => ({
    connectStorage: vi.fn().mockResolvedValue(undefined),
    storageLookup: vi.fn().mockResolvedValue(entry()),
    fileOpenExternal: vi.fn().mockResolvedValue({ sessionToken: 'tok', localPath: '/tmp/x/hosts' }),
    onExternalFileStatus: vi.fn().mockReturnValue(() => {}),
    ...over,
  });
  const run = async (promise: Promise<void>) => {
    await act(async () => {
      await promise;
    });
  };

  it('opens a file of this machine with the system app, and says nothing', async () => {
    const a = api();
    const onOpenPath = vi.fn();
    const { click, notify } = setup(a, { onOpenPath });
    await run(click('/etc/hosts'));
    expect(a.fileOpenExternal).toHaveBeenCalledWith('local', '/etc/hosts');
    expect(onOpenPath).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it('opens a remote file, says that saving uploads it, and reports the uploads', async () => {
    let emit: (e: unknown) => void = () => {};
    const a = api({
      onExternalFileStatus: vi.fn().mockImplementation((cb: (e: unknown) => void) => {
        emit = cb;
        return () => {};
      }),
    });
    const { click, notify } = setup(a, { target: remoteTarget, onOpenPath: vi.fn() });
    await run(click('/etc/hosts'));
    expect(a.fileOpenExternal).toHaveBeenCalledWith('sftp-h', '/etc/hosts');
    expect(notify).toHaveBeenCalledWith('Opened hosts. Saving it there uploads the change.', 3000);

    act(() => emit({ sessionToken: 'tok', status: 'uploaded' }));
    expect(notify).toHaveBeenLastCalledWith('Uploaded hosts', 2000);
    act(() => emit({ sessionToken: 'tok', status: 'error', error: 'Permission denied' }));
    expect(notify).toHaveBeenLastCalledWith('Upload of hosts failed: Permission denied', 6000);
  });

  it('shows the file in the file manager, as before, when that is the setting', async () => {
    const a = api();
    const onOpenPath = vi.fn();
    const { click, notify } = setup(a, { onOpenPath, pathClickAction: 'filemanager' });
    await run(click('/etc/hosts'));
    expect(onOpenPath).toHaveBeenCalledWith('/etc/hosts');
    expect(a.fileOpenExternal).not.toHaveBeenCalled();
    expect(a.storageLookup).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it('shows a folder in the file manager', async () => {
    const a = api({ storageLookup: vi.fn().mockResolvedValue(entry({ isDirectory: true, name: 'etc' })) });
    const onOpenPath = vi.fn();
    const { click } = setup(a, { onOpenPath });
    await run(click('/etc'));
    expect(onOpenPath).toHaveBeenCalledWith('/etc');
    expect(a.fileOpenExternal).not.toHaveBeenCalled();
  });

  it('falls back to the file manager and tells why when the main process refuses the file', async () => {
    const a = api({
      fileOpenExternal: vi.fn().mockRejectedValue(new Error('Refusing to open "setup.exe" with the OS default handler')),
    });
    const onOpenPath = vi.fn();
    const { click, notify } = setup(a, { onOpenPath });
    await run(click('/srv/setup.exe'));
    expect(onOpenPath).toHaveBeenCalledWith('/srv/setup.exe');
    expect(notify).toHaveBeenCalledWith('Could not open setup.exe: Refusing to open "setup.exe" with the OS default handler', 4000);
  });

  it('does not start a program from a relative path while the working directory is a guess', async () => {
    const a = api();
    const onOpenPath = vi.fn();
    const { click, notify } = setup(a, { onOpenPath });
    await run(click('./run.txt'));
    expect(a.fileOpenExternal).not.toHaveBeenCalled();
    expect(onOpenPath).toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('current directory'), 4000);
  });

  it('never looks up or opens a network share', async () => {
    const a = api();
    const onOpenPath = vi.fn();
    const { click, notify } = setup(a, { onOpenPath });
    await run(click('\\\\attacker\\share\\payload.txt'));
    expect(a.storageLookup).not.toHaveBeenCalled();
    expect(a.fileOpenExternal).not.toHaveBeenCalled();
    expect(onOpenPath).toHaveBeenCalledTimes(1);
    expect(notify).not.toHaveBeenCalled();
  });

  it('does not open a path that a local shell running ssh printed', async () => {
    const terminalHasSshClient = vi.fn().mockResolvedValue(true);
    const a = api({ terminalHasSshClient });
    const onOpenPath = vi.fn();
    const { click } = setup(a, { onOpenPath, sessionId: 's1' });
    await run(click('/etc/hosts'));
    expect(terminalHasSshClient).toHaveBeenCalledWith('s1');
    expect(a.fileOpenExternal).not.toHaveBeenCalled();
    expect(onOpenPath).toHaveBeenCalledWith('/etc/hosts');
  });

  it('starts one download for two clicks on the same file', async () => {
    let release: (e: FileEntry) => void = () => {};
    const a = api({ storageLookup: vi.fn().mockImplementation(() => new Promise((r) => (release = r))) });
    const { click } = setup(a, { onOpenPath: vi.fn() });
    const first = click('/etc/hosts');
    const second = click('/etc/hosts');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      release(entry());
      await Promise.all([first, second]);
    });
    expect(a.fileOpenExternal).toHaveBeenCalledTimes(1);
  });

  it('can be clicked again once the first click is done', async () => {
    const a = api();
    const { click } = setup(a, { onOpenPath: vi.fn() });
    await run(click('/etc/hosts'));
    await run(click('/etc/hosts'));
    expect(a.fileOpenExternal).toHaveBeenCalledTimes(2);
  });
});
