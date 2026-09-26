import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from '@xterm/addon-fit';
import 'xterm/css/xterm.css';
import { RotateCcw, X } from 'lucide-react';
import type { SSHConnectionConfig, SSHPtyExitEvent, LocalShellType } from '@shared/types/ssh';
import type { SessionExitAction } from '@shared/types/settings';
import type { K8sTerminalTarget } from '@shared/types/kubernetes';
import { extractHostnameFromCommand, scanOutputForHost } from '../lib/terminalTitle';

export interface TerminalViewProps {
  /** Omit together with `local` to spawn a local shell instead of an SSH session. */
  config?: SSHConnectionConfig;
  /** Spawn a local shell (user's default shell on macOS/Linux, chosen shell on Windows) instead of connecting over SSH. */
  local?: boolean;
  /** Windows only: which local shell to spawn when `local` is set. */
  shellType?: LocalShellType;
  /** Windows only: specific WSL distribution to launch. */
  wslDistro?: string;
  /** Set to run an interactive exec session inside a Kubernetes/OpenShift container instead of SSH or a local shell. */
  k8sTarget?: K8sTerminalTarget;
  isActive?: boolean;
  onExit?: (event: SSHPtyExitEvent) => void;
  className?: string;
  fontSize?: number;
  fontFamily?: string;
  theme?: 'dark' | 'light' | 'breeze' | 'system';
  /** Remote directory to `cd` into once the shell prompt appears (sent once, after first PTY output). */
  initialCwd?: string;
  /** Action on session exit: 'reconnect' (default), 'close' (auto-close tab on clean exit), or 'keep' (passive). */
  sessionExitAction?: SessionExitAction;
  /** Mirror text selections into the system clipboard, not just the X11 PRIMARY selection. */
  copyOnSelect?: boolean;
  /** Callback to close the enclosing tab. */
  onCloseTab?: () => void;
  /** Emitted when an OSC 0 or OSC 2 title sequence is received from the shell. */
  onTitleChange?: (title: string) => void;
}

function shellQuote(path: string): string {
  return `'${path.replace(/'/g, `'\\''`)}'`;
}

const XTERM_LIGHT_THEME = {
  background: '#f8fafc', // Soft slate-50 instead of harsh #ffffff
  foreground: '#1e293b', // Crisp slate-800 instead of black
  cursor: '#0284c7', // Sky-600
  cursorAccent: '#f8fafc',
  selectionBackground: '#e2e8f0', // Slate-200
  black: '#1e293b',
  red: '#dc2626',
  green: '#16a34a',
  yellow: '#ca8a04',
  blue: '#0284c7',
  magenta: '#9333ea',
  cyan: '#0891b2',
  white: '#ffffff',
  brightBlack: '#64748b',
  brightRed: '#ef4444',
  brightGreen: '#22c55e',
  brightYellow: '#eab308',
  brightBlue: '#38bdf8',
  brightMagenta: '#c084fc',
  brightCyan: '#06b6d4',
  brightWhite: '#ffffff',
};

const XTERM_DARK_THEME = {
  background: '#0f172a', // slate-900
  foreground: '#f8fafc', // slate-50
  cursor: '#38bdf8', // sky-400
  cursorAccent: '#0f172a',
  selectionBackground: '#334155', // slate-700
  black: '#0f172a',
  red: '#ef4444',
  green: '#22c55e',
  yellow: '#eab308',
  blue: '#38bdf8',
  magenta: '#c084fc',
  cyan: '#06b6d4',
  white: '#f8fafc',
  brightBlack: '#64748b',
  brightRed: '#f87171',
  brightGreen: '#4ade80',
  brightYellow: '#fde047',
  brightBlue: '#60a5fa',
  brightMagenta: '#d8b4fe',
  brightCyan: '#22d3ee',
  brightWhite: '#ffffff',
};

const XTERM_BREEZE_THEME = {
  background: '#232627',
  foreground: '#fcfcfc',
  cursor: '#3daee9',
  cursorAccent: '#232627',
  selectionBackground: '#31363b',
  black: '#232627',
  red: '#ed1515',
  green: '#11d116',
  yellow: '#f67400',
  blue: '#1d9bf3',
  magenta: '#9b59b6',
  cyan: '#1abc9c',
  white: '#fcfcfc',
  brightBlack: '#7f8c8d',
  brightRed: '#c0392b',
  brightGreen: '#1cdc9a',
  brightYellow: '#fdbc4b',
  brightBlue: '#3daee9',
  brightMagenta: '#8e44ad',
  brightCyan: '#16a085',
  brightWhite: '#ffffff',
};

function getXTermTheme(themeName: 'dark' | 'light' | 'breeze' | 'system') {
  if (themeName === 'breeze') return XTERM_BREEZE_THEME;
  if (themeName === 'light') return XTERM_LIGHT_THEME;
  if (themeName === 'system') {
    const isSystemLight = Boolean(window.matchMedia?.('(prefers-color-scheme: light)')?.matches);
    return isSystemLight ? XTERM_LIGHT_THEME : XTERM_DARK_THEME;
  }
  return XTERM_DARK_THEME;
}

export const TerminalView: React.FC<TerminalViewProps> = ({
  config,
  local = false,
  shellType,
  wslDistro,
  k8sTarget,
  isActive = true,
  onExit,
  className = '',
  fontSize = 13,
  fontFamily = 'Menlo, Monaco, "Courier New", monospace, Consolas',
  theme = 'dark',
  initialCwd,
  sessionExitAction = 'reconnect',
  copyOnSelect = false,
  onCloseTab,
  onTitleChange,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;
  const onTitleChangeRef = useRef(onTitleChange);
  onTitleChangeRef.current = onTitleChange;
  const configRef = useRef(config);
  configRef.current = config;
  const initialCwdRef = useRef(initialCwd);
  initialCwdRef.current = initialCwd;
  const k8sTargetRef = useRef(k8sTarget);
  k8sTargetRef.current = k8sTarget;
  const fontSizeRef = useRef(fontSize);
  fontSizeRef.current = fontSize;
  const fontFamilyRef = useRef(fontFamily);
  fontFamilyRef.current = fontFamily;
  const themeRef = useRef(theme);
  themeRef.current = theme;

  const connectionKey = useMemo(() => {
    if (local) return `local:${shellType || ''}:${wslDistro || ''}`;
    if (k8sTarget) return `k8s:${k8sTarget.contextName}:${k8sTarget.namespace}:${k8sTarget.podName}:${k8sTarget.containerName}`;
    if (config) return `ssh:${config.id || ''}:${config.host}:${config.port ?? 22}:${config.username}`;
    return '';
  }, [local, shellType, wslDistro, k8sTarget, config?.id, config?.host, config?.port, config?.username]);

  const sessionExitActionRef = useRef(sessionExitAction);
  sessionExitActionRef.current = sessionExitAction;
  const onCloseTabRef = useRef(onCloseTab);
  onCloseTabRef.current = onCloseTab;
  const copyOnSelectRef = useRef(copyOnSelect);
  copyOnSelectRef.current = copyOnSelect;
  const isActiveRef = useRef(isActive);
  isActiveRef.current = isActive;
  // Tracks the size last reported to the PTY, shared between the resize observer and the
  // "becomes active" effect so both can decide whether a SIGWINCH sync is actually needed.
  const lastColsRef = useRef(0);
  const lastRowsRef = useRef(0);

  const [sessionKey, setSessionKey] = useState(0);
  const [exitEvent, setExitEvent] = useState<SSHPtyExitEvent | null>(null);

  // Lazy connection: background tabs (isActive === false on mount) defer
  // creating the PTY and spawning SSH until they become active for the first time.
  const [hasEverBeenActive, setHasEverBeenActive] = useState<boolean>(isActive);

  useEffect(() => {
    if (isActive && !hasEverBeenActive) {
      setHasEverBeenActive(true);
    }
  }, [isActive, hasEverBeenActive]);

  const handleReconnect = useCallback(() => {
    setExitEvent(null);
    setSessionKey((prev) => prev + 1);
  }, []);

  /**
   * Fits the xterm buffer to its container and synchronizes dimensions to the backend PTY.
   * While the container is hidden (display: none), fitting is skipped to prevent 0x0 degenerate sizes.
   */
  const syncPtySize = useCallback((force = false) => {
    if (!termRef.current || !fitAddonRef.current) return;
    if (!isActiveRef.current) return;
    try {
      try {
        const core = (termRef.current as any)?._core;
        if (core?._charSizeService && !core._charSizeService.hasValidSize) {
          core._charSizeService.measure();
        }
      } catch {
        // Safe to ignore if charSizeService is not accessible
      }
      fitAddonRef.current.fit();
      const newCols = termRef.current.cols;
      const newRows = termRef.current.rows;
      if (
        sessionIdRef.current &&
        (force || newCols !== lastColsRef.current || newRows !== lastRowsRef.current) &&
        newCols >= 10 &&
        newRows >= 3
      ) {
        lastColsRef.current = newCols;
        lastRowsRef.current = newRows;
        const resize = k8sTargetRef.current ? window.multissh?.k8sTerminalResize : window.multissh?.terminalResize;
        resize?.(sessionIdRef.current, newCols, newRows);
      }
    } catch {
      // Safe to ignore resize on hidden element
    }
  }, []);

  // Focus and fit when becoming active
  useEffect(() => {
    if (isActive && fitAddonRef.current && termRef.current) {
      let isCancelled = false;
      try {
        termRef.current.focus();
        // The pane was `display: none` while inactive; xterm's renderer can leave a stale
        // paint (cursor drawn at its pre-hide position) until new PTY output forces a redraw.
        termRef.current.refresh(0, termRef.current.rows - 1);
        syncPtySize(true);
      } catch {
        // Safe to ignore resize on hidden element
      }

      // When activating a tab that was in the background (display: none),
      // the DOM layout pass and font metrics measurement need frames/ticks to settle.
      // Repeatedly sync dimensions across requestAnimationFrame and short intervals
      // to ensure the PTY receives the true cols/rows immediately on activation.
      const raf1 = requestAnimationFrame(() => {
        if (!isCancelled) syncPtySize(true);
      });
      const raf2 = requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!isCancelled) syncPtySize(true);
        });
      });
      const t1 = setTimeout(() => {
        if (!isCancelled) syncPtySize(true);
      }, 50);
      const t2 = setTimeout(() => {
        if (!isCancelled) syncPtySize(true);
      }, 150);
      const t3 = setTimeout(() => {
        if (!isCancelled) syncPtySize(true);
      }, 300);

      if (document.fonts) {
        document.fonts.ready.then(() => {
          if (!isCancelled) {
            syncPtySize(true);
          }
        });
      }

      return () => {
        isCancelled = true;
        cancelAnimationFrame(raf1);
        cancelAnimationFrame(raf2);
        clearTimeout(t1);
        clearTimeout(t2);
        clearTimeout(t3);
      };
    }
    return undefined;
  }, [isActive, syncPtySize]);

  // Update terminal options when props change without recreating the PTY session
  useEffect(() => {
    if (termRef.current) {
      termRef.current.options.fontSize = fontSize;
      termRef.current.options.fontFamily = fontFamily;
      termRef.current.options.theme = getXTermTheme(theme);
      syncPtySize();
      if (document.fonts) {
        document.fonts.ready.then(() => {
          syncPtySize();
        });
      }
    }
  }, [fontSize, fontFamily, theme, syncPtySize]);

  // Main lifecycle: spawns and manages the PTY session.
  // Style properties are intentionally managed by the separate effect above to avoid session resets.
  useEffect(() => {
    if (!hasEverBeenActive) return;

    const container = containerRef.current;
    if (!container) return;

    setExitEvent(null);
    let isDisposed = false;
    let unsubData: (() => void) | null = null;
    let unsubExit: (() => void) | null = null;
    let resizeObserver: ResizeObserver | null = null;

    const currentTheme = themeRef.current;

    // 1. Initialize Terminal & FitAddon
    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontSize: fontSizeRef.current,
      fontFamily: fontFamilyRef.current,
      theme: getXTermTheme(currentTheme),
      allowProposedApi: true,
    });
    termRef.current = term;

    const fitAddon = new FitAddon();
    fitAddonRef.current = fitAddon;
    term.loadAddon(fitAddon);

    term.open(containerRef.current);
    if (isActiveRef.current) {
      try {
        term.focus();
      } catch {
        // Safe to ignore in test/headless env
      }
    }

    const titleSub = term.onTitleChange((title) => {
      onTitleChangeRef.current?.(title);
    });

    // Copy-on-select mirrors the selection into the system CLIPBOARD (not just the
    // browser/X11 PRIMARY selection middle-click already gets for free), so keyboard
    // paste shortcuts that read CLIPBOARD have something to paste.
    const selectionSub = term.onSelectionChange(() => {
      if (!copyOnSelectRef.current) return;
      const selection = term.getSelection();
      if (selection) {
        navigator.clipboard?.writeText(selection).catch(() => {
          // Ignore: clipboard access can be denied (no focus, permissions, etc.)
        });
      }
    });

    // Shift+Insert is the conventional Linux terminal "paste from clipboard" shortcut;
    // xterm.js only reacts to the browser's native paste event (typically Ctrl/Cmd+V),
    // so it's wired up explicitly here.
    // Also prevent xterm from intercepting/swallowing tab switching shortcuts (Ctrl+Tab, Ctrl+Shift+Tab).
    term.attachCustomKeyEventHandler((e) => {
      if (e.type === 'keydown' && e.shiftKey && e.key === 'Insert') {
        navigator.clipboard
          ?.readText()
          .then((text) => {
            if (text) term.paste(text);
          })
          .catch(() => {
            // Ignore: clipboard access can be denied
          });
        return false;
      }
      if (
        (e.ctrlKey || e.metaKey) &&
        (e.key === 'Tab' || e.key === 'ISO_Left_Tab' || e.code === 'Tab' || e.keyCode === 9)
      ) {
        return false;
      }
      return true;
    });

    try {
      fitAddon.fit();
    } catch {
      // Ignore initial fit calculation in JSDOM / zero-size
    }

    if (document.fonts) {
      document.fonts.ready.then(() => {
        if (!isDisposed) {
          syncPtySize();
        }
      });
    }

    const cols = term.cols || 80;
    const rows = term.rows || 24;
    lastColsRef.current = cols;
    lastRowsRef.current = rows;

    // 2. Create Terminal Session via IPC
    // Always spawn under a fresh session id, never the saved profile's own id:
    // reusing it would let two mounts of the same profile (two tabs, or React
    // StrictMode's dev-mode double-invoke) collide on the same map entry in
    // SSHPtyManager, so killing one session tears down the other instead.
    const activeConfig = configRef.current;
    if (local || activeConfig || k8sTarget) {
      const killSession = k8sTarget ? window.multissh?.k8sTerminalKill : window.multissh?.terminalKill;
      const createPromise = k8sTarget
        ? window.multissh?.k8sTerminalCreate?.(k8sTarget, { cols, rows })
        : window.multissh?.terminalCreate?.(
            local
              ? { local: true as const, ptyOptions: { cols, rows, shellType, wslDistro } }
              : { config: { ...(activeConfig as SSHConnectionConfig), id: crypto.randomUUID() }, ptyOptions: { cols, rows } }
          );
      createPromise
        ?.then(({ sessionId }) => {
          if (isDisposed) {
            // Already unmounted while waiting for session creation
            killSession?.(sessionId);
            return;
          }
          sessionIdRef.current = sessionId;

          // Force PTY size synchronization once session ID is established.
          // On app launch or tab restoration, the session was spawned with provisional
          // dimensions (80x24) while the DOM layout was still settling. Now that the
          // session ID is bound and container is in the DOM, re-measure with fit()
          // and push the true cols/rows to the backend PTY so the shell receives SIGWINCH.
          syncPtySize(true);
          requestAnimationFrame(() => syncPtySize());
          setTimeout(() => syncPtySize(), 60);
          setTimeout(() => syncPtySize(), 200);

          // 2b. If requested, cd into a starting directory once the remote
          // shell has had a moment to print its prompt. There's no "wait for
          // prompt" signal from the PTY, so we send it shortly after the
          // first data arrives from the remote side.
          let cwdSent = false;
          const sendInitialCwd = () => {
            if (cwdSent) return;
            cwdSent = true;
            const cwd = initialCwdRef.current;
            if (cwd && sessionIdRef.current && window.multissh?.terminalWrite) {
              setTimeout(() => {
                if (!isDisposed && sessionIdRef.current) {
                  window.multissh.terminalWrite(sessionIdRef.current, `cd ${shellQuote(cwd)}\n`);
                }
              }, 400);
            }
          };

          // 3. User input to PTY
          let inputLineBuffer = '';
          term.onData((data) => {
            const write = k8sTarget ? window.multissh?.k8sTerminalWrite : window.multissh?.terminalWrite;
            if (sessionIdRef.current && write) {
              write(sessionIdRef.current, data);
            }
            if (data.includes('\r') || data.includes('\n')) {
              const parts = data.split(/[\r\n]+/);
              const cmd = (inputLineBuffer + (parts[0] || '')).trim();
              inputLineBuffer = parts.length > 1 ? parts[parts.length - 1] : '';
              const target = extractHostnameFromCommand(cmd);
              if (target) {
                onTitleChangeRef.current?.(`ssh ${target}`);
              } else if (/^(exit|logout)$/i.test(cmd)) {
                onTitleChangeRef.current?.('__EXIT__');
              }
            } else if (data === '\x04') {
              // Ctrl+D (EOF/exit)
              onTitleChangeRef.current?.('__EXIT__');
            } else if (data === '\x7f' || data === '\b') {
              inputLineBuffer = inputLineBuffer.slice(0, -1);
            } else {
              // Strip control escape characters, retain printable text (including pasted commands)
              // eslint-disable-next-line no-control-regex
              const printable = data.replace(/[\x00-\x1f\x7f-\x9f]/g, '');
              inputLineBuffer += printable;
            }
          });

          // 4. Data from PTY to xterm
          const onData = k8sTarget ? window.multissh?.onK8sTerminalData : window.multissh?.onTerminalData;
          if (onData) {
            unsubData = onData((sessId, data) => {
              if (sessId === sessionIdRef.current) {
                term.write(data);
                sendInitialCwd();
                if (!k8sTarget) {
                  const detectedHost = scanOutputForHost(data);
                  if (detectedHost) {
                    onTitleChangeRef.current?.(detectedHost);
                  }
                }
              }
            });
          }

          // 5. Exit from PTY / exec session
          if (k8sTarget) {
            if (window.multissh?.onK8sTerminalExit) {
              unsubExit = window.multissh.onK8sTerminalExit((sessId, event) => {
                if (sessId === sessionIdRef.current) {
                  term.write(`\r\n\x1b[33m[Session terminated: ${event.status}]\x1b[0m\r\n`);
                  const mapped: SSHPtyExitEvent = { exitCode: event.status === 'Success' ? 0 : 1 };
                  onExitRef.current?.(mapped);

                  const action = sessionExitActionRef.current;
                  if (action === 'close' && mapped.exitCode === 0 && onCloseTabRef.current) {
                    onCloseTabRef.current();
                  } else if (action !== 'keep') {
                    setExitEvent(mapped);
                  }
                }
              });
            }
          } else if (window.multissh?.onTerminalExit) {
            unsubExit = window.multissh.onTerminalExit((sessId, event) => {
              if (sessId === sessionIdRef.current) {
                term.write(
                  `\r\n\x1b[33m[Session terminated (code: ${event.exitCode})]\x1b[0m\r\n`
                );
                onExitRef.current?.(event);

                const action = sessionExitActionRef.current;
                if (action === 'close' && event.exitCode === 0 && onCloseTabRef.current) {
                  onCloseTabRef.current();
                } else if (action !== 'keep') {
                  setExitEvent(event);
                }
              }
            });
          }
        })
        .catch((err) => {
          if (!isDisposed) {
            term.write(`\r\n\x1b[31mFailed to start terminal session: ${err.message}\x1b[0m\r\n`);
            if (sessionExitActionRef.current !== 'keep') {
              setExitEvent({ exitCode: 1 });
            }
          }
        });
    }

    // 6. Handle Resize
    if (typeof ResizeObserver !== 'undefined' && containerRef.current) {
      resizeObserver = new ResizeObserver(() => {
        syncPtySize();
      });
      resizeObserver.observe(containerRef.current);
    }

    // 7. Cleanup on unmount
    return () => {
      isDisposed = true;
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      if (unsubData) {
        unsubData();
      }
      if (unsubExit) {
        unsubExit();
      }
      titleSub.dispose();
      selectionSub.dispose();
      const sid = sessionIdRef.current;
      const killSession = k8sTarget ? window.multissh?.k8sTerminalKill : window.multissh?.terminalKill;
      if (sid && killSession) {
        killSession(sid);
      }
      term.dispose();
      if (container) {
        container.innerHTML = '';
      }
      termRef.current = null;
      fitAddonRef.current = null;
      sessionIdRef.current = null;
    };
  }, [connectionKey, sessionKey, syncPtySize, hasEverBeenActive]);

  const isLight =
    theme === 'light' ||
    (theme === 'system' &&
      typeof window !== 'undefined' &&
      Boolean(window.matchMedia?.('(prefers-color-scheme: light)')?.matches));
  const isBreeze = theme === 'breeze';

  return (
    <div
      data-testid="terminal-view"
      className={`relative h-full w-full overflow-hidden ${
        isBreeze ? 'bg-[#232627]' : isLight ? 'bg-[#f8fafc]' : 'bg-[#0f172a]'
      } ${className}`}
    >
      <div
        ref={containerRef}
        data-testid="terminal-container"
        className="h-full w-full p-2 focus:outline-none"
      />

      {exitEvent && (
        <div
          data-testid="session-exit-overlay"
          className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-3 px-4 py-2.5 rounded-xl bg-slate-900/90 dark:bg-slate-800/95 border border-slate-700/80 shadow-2xl backdrop-blur-md text-xs text-slate-200 z-20 animate-fade-in"
        >
          <div className="flex items-center gap-2 pr-2 border-r border-slate-700/70">
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                exitEvent.exitCode === 0
                  ? 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.5)]'
                  : 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.5)]'
              }`}
            />
            <span className="font-medium text-slate-200">
              Session ended{exitEvent.exitCode !== undefined ? ` (code ${exitEvent.exitCode})` : ''}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleReconnect}
              data-testid="reconnect-button"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 active:bg-sky-700 text-white font-medium shadow-sm transition-colors cursor-pointer"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reconnect
            </button>

            {onCloseTab && (
              <button
                type="button"
                onClick={onCloseTab}
                data-testid="close-tab-button"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 active:bg-slate-700 text-slate-300 hover:text-white font-medium transition-colors cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
                Close Tab
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
