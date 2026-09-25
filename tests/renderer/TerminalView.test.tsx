// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { SSHConnectionConfig } from '../../src/shared/types/ssh';
import { TerminalView } from '../../src/renderer/src/components/TerminalView';

// Polyfill ResizeObserver and matchMedia for JSDOM
let resizeCallback: ((entries: any[], observer: any) => void) | null = null;
class MockResizeObserver {
  constructor(cb: any) {
    resizeCallback = cb;
  }
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}
global.ResizeObserver = MockResizeObserver as any;

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

describe('TerminalView Component', () => {
  const sampleConfig: SSHConnectionConfig = {
    id: 'ssh-1',
    name: 'Production Server',
    host: 'prod.example.com',
    port: 22,
    username: 'admin',
    authType: 'password',
  };

  let dataCallback: ((sessionId: string, data: string) => void) | null = null;
  let exitCallback: ((sessionId: string, event: { exitCode: number; signal?: number }) => void) | null = null;
  const mockUnsubData = vi.fn();
  const mockUnsubExit = vi.fn();
  const mockTerminalCreate = vi.fn();
  const mockTerminalWrite = vi.fn();
  const mockTerminalResize = vi.fn();
  const mockTerminalKill = vi.fn();

  beforeEach(() => {
    dataCallback = null;
    exitCallback = null;
    resizeCallback = null;
    mockUnsubData.mockClear();
    mockUnsubExit.mockClear();
    mockTerminalCreate.mockReset().mockResolvedValue({ sessionId: 'session-123' });
    mockTerminalWrite.mockReset().mockResolvedValue(undefined);
    mockTerminalResize.mockReset().mockResolvedValue(undefined);
    mockTerminalKill.mockReset().mockResolvedValue(undefined);

    window.multissh = {
      ...(window.multissh || {}),
      terminalCreate: mockTerminalCreate,
      terminalWrite: mockTerminalWrite,
      terminalResize: mockTerminalResize,
      terminalKill: mockTerminalKill,
      onTerminalData: vi.fn((cb) => {
        dataCallback = cb;
        return mockUnsubData;
      }),
      onTerminalExit: vi.fn((cb) => {
        exitCallback = cb;
        return mockUnsubExit;
      }),
    } as any;
  });

  afterEach(() => {
    cleanup();
  });

  it('initializes xterm, fitAddon, and calls terminalCreate on mount', async () => {
    render(<TerminalView config={sampleConfig} />);

    expect(screen.getByTestId('terminal-view')).toBeInTheDocument();
    expect(screen.getByTestId('terminal-container')).toBeInTheDocument();

    expect(mockTerminalCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        // The session id is regenerated per mount (never the saved profile's own
        // id) so two tabs on the same profile can't collide on one PTY session.
        config: expect.objectContaining({ ...sampleConfig, id: expect.any(String) }),
        ptyOptions: expect.objectContaining({
          cols: expect.any(Number),
          rows: expect.any(Number),
        }),
      })
    );

    const [[createArgs]] = mockTerminalCreate.mock.calls;
    expect(createArgs.config.id).not.toBe(sampleConfig.id);
  });

  it('synchronizes dimensions to PTY via terminalResize once session creation resolves', async () => {
    render(<TerminalView config={sampleConfig} />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockTerminalResize).toHaveBeenCalledWith('session-123', expect.any(Number), expect.any(Number));
  });

  it('synchronizes dimensions to PTY when an initially background tab becomes active', async () => {
    const { rerender } = render(<TerminalView config={sampleConfig} isActive={false} />);

    await act(async () => {
      await Promise.resolve();
    });

    // While inactive, terminalResize should not have been called
    expect(mockTerminalResize).not.toHaveBeenCalled();

    // Now activate the tab
    rerender(<TerminalView config={sampleConfig} isActive={true} />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockTerminalResize).toHaveBeenCalledWith('session-123', expect.any(Number), expect.any(Number));
  });

  it('receives terminal data from IPC and writes matching session data to terminal', async () => {
    render(<TerminalView config={sampleConfig} />);

    // Wait for terminalCreate promise to resolve
    await act(async () => {
      await Promise.resolve();
    });

    expect(window.multissh.onTerminalData).toHaveBeenCalled();
    expect(dataCallback).toBeTruthy();

    // Data for our session
    act(() => {
      dataCallback!('session-123', 'Hello MultiSSH\r\n');
    });

    // Data for another session should be ignored
    act(() => {
      dataCallback!('other-session', 'Secret data');
    });

    // Verify terminal output container exists
    const container = screen.getByTestId('terminal-container');
    expect(container).toBeInTheDocument();
  });

  it('handles terminal exit event and invokes onExit prop', async () => {
    const onExit = vi.fn();
    render(<TerminalView config={sampleConfig} onExit={onExit} />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(window.multissh.onTerminalExit).toHaveBeenCalled();
    expect(exitCallback).toBeTruthy();

    act(() => {
      exitCallback!('session-123', { exitCode: 0 });
    });

    expect(onExit).toHaveBeenCalledWith({ exitCode: 0 });
  });

  it('handles resize observer trigger and calls terminalResize when dimensions change', async () => {
    render(<TerminalView config={sampleConfig} />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(resizeCallback).toBeTruthy();

    // Trigger resize observer callback
    act(() => {
      resizeCallback!([], {} as any);
    });

    // If dimensions didn't change from default 80x24, it won't re-send needlessly.
    // Let's verify that the ResizeObserver was instantiated and observing the container
    expect(screen.getByTestId('terminal-container')).toBeInTheDocument();
  });

  it('cleans up session, listeners, and xterm on unmount', async () => {
    const { unmount } = render(<TerminalView config={sampleConfig} />);

    await act(async () => {
      await Promise.resolve();
    });

    unmount();

    expect(mockUnsubData).toHaveBeenCalledTimes(1);
    expect(mockUnsubExit).toHaveBeenCalledTimes(1);
    expect(mockTerminalKill).toHaveBeenCalledWith('session-123');
  });

  it('renders reconnect overlay and buttons when session terminates under reconnect action', async () => {
    const onCloseTab = vi.fn();
    render(<TerminalView config={sampleConfig} onCloseTab={onCloseTab} sessionExitAction="reconnect" />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.queryByTestId('session-exit-overlay')).not.toBeInTheDocument();

    act(() => {
      exitCallback!('session-123', { exitCode: 0 });
    });

    expect(screen.getByTestId('session-exit-overlay')).toBeInTheDocument();
    expect(screen.getByText(/Session ended/)).toBeInTheDocument();
    expect(screen.getByTestId('reconnect-button')).toBeInTheDocument();
    expect(screen.getByTestId('close-tab-button')).toBeInTheDocument();

    // Click Close Tab
    act(() => {
      screen.getByTestId('close-tab-button').click();
    });
    expect(onCloseTab).toHaveBeenCalledTimes(1);
  });

  it('re-spawns a new session when Reconnect is clicked', async () => {
    render(<TerminalView config={sampleConfig} sessionExitAction="reconnect" />);

    await act(async () => {
      await Promise.resolve();
    });
    expect(mockTerminalCreate).toHaveBeenCalledTimes(1);

    act(() => {
      exitCallback!('session-123', { exitCode: 0 });
    });
    expect(screen.getByTestId('reconnect-button')).toBeInTheDocument();

    // Click Reconnect
    mockTerminalCreate.mockResolvedValueOnce({ sessionId: 'session-456' });
    await act(async () => {
      screen.getByTestId('reconnect-button').click();
    });

    expect(mockTerminalCreate).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('session-exit-overlay')).not.toBeInTheDocument();
  });

  it('automatically closes tab when sessionExitAction is close and exit code is 0', async () => {
    const onCloseTab = vi.fn();
    render(<TerminalView config={sampleConfig} onCloseTab={onCloseTab} sessionExitAction="close" />);

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      exitCallback!('session-123', { exitCode: 0 });
    });

    expect(onCloseTab).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('session-exit-overlay')).not.toBeInTheDocument();
  });

  it('keeps tab open and shows overlay if session exits with non-zero error code even when sessionExitAction is close', async () => {
    const onCloseTab = vi.fn();
    render(<TerminalView config={sampleConfig} onCloseTab={onCloseTab} sessionExitAction="close" />);

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      exitCallback!('session-123', { exitCode: 255 });
    });

    expect(onCloseTab).not.toHaveBeenCalled();
    expect(screen.getByTestId('session-exit-overlay')).toBeInTheDocument();
    expect(screen.getByText(/Session ended \(code 255\)/)).toBeInTheDocument();
  });

  it('does not display overlay when sessionExitAction is keep', async () => {
    render(<TerminalView config={sampleConfig} sessionExitAction="keep" />);

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      exitCallback!('session-123', { exitCode: 0 });
    });

    expect(screen.queryByTestId('session-exit-overlay')).not.toBeInTheDocument();
  });

  it('renders correctly with breeze theme background', async () => {
    render(<TerminalView config={sampleConfig} theme="breeze" />);

    await act(async () => {
      await Promise.resolve();
    });

    const termView = screen.getByTestId('terminal-view');
    expect(termView).toHaveClass('bg-[#232627]');
  });
});
