import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from '@xterm/addon-fit';
import 'xterm/css/xterm.css';
import { RotateCcw, X } from 'lucide-react';
import type { SSHConnectionConfig, SSHPtyExitEvent, LocalShellType } from '@shared/types/ssh';
import type { SessionExitAction } from '@shared/types/settings';
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
  const initialCwdRef = useRef(initialCwd);
  initialCwdRef.current = initialCwd;
  const fontSizeRef = useRef(fontSize);
  fontSizeRef.current = fontSize;
  const fontFamilyRef = useRef(fontFamily);
  fontFamilyRef.current = fontFamily;
  const themeRef = useRef(theme);
  themeRef.current = theme;

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

  const handleReconnect = useCallback(() => {
    setExitEvent(null);
    setSessionKey((prev) => prev + 1);
  }, []);

  // Focus and fit when becoming active
  useEffect(() => {
    if (isActive && fitAddonRef.current && termRef.current) {
      try {
        fitAddonRef.current.fit();
        termRef.current.focus();
        // The pane was `display: none` while inactive; xterm's renderer can leave a stale
        // paint (cursor drawn at its pre-hide position) until new PTY output forces a redraw.
        termRef.current.refresh(0, termRef.current.rows - 1);

        // fit() only resizes xterm's local buffer. If the pane's size actually changed while
        // hidden (font metrics loading, sidebar toggling, etc.) but the ResizeObserver below
        // never fired because the element was `display: none`, the PTY never got a SIGWINCH.
        // Bash's readline then computes cursor position against the stale width while xterm
        // renders at the new one, producing a horizontal offset until the next keystroke
        // partially self-corrects it. Explicitly re-sync here so the PTY size can never drift.
        const newCols = termRef.current.cols;
        const newRows = termRef.current.rows;
        if (
          sessionIdRef.current &&
          (newCols !== lastColsRef.current || newRows !== lastRowsRef.current) &&
          newCols > 0 &&
          newRows > 0
        ) {
          lastColsRef.current = newCols;
          lastRowsRef.current = newRows;
          window.multissh?.terminalResize(sessionIdRef.current, newCols, newRows);
        }
      } catch {
        // Safe to ignore resize on hidden element
      }
    }
  }, [isActive]);

  // Update terminal options when props change without recreating the PTY session
  useEffect(() => {
    if (termRef.current) {
      termRef.current.options.fontSize = fontSize;
      termRef.current.options.fontFamily = fontFamily;
      termRef.current.options.theme = getXTermTheme(theme);
      try {
        fitAddonRef.current?.fit();
      } catch {
        // Safe to ignore initial fit in hidden elements
      }
      if (document.fonts) {
        document.fonts.ready.then(() => {
          try {
            fitAddonRef.current?.fit();
          } catch {
            // Safe to ignore
          }
        });
      }
    }
  }, [fontSize, fontFamily, theme]);

  // Main lifecycle: spawns and manages the PTY session.
  // Style properties are intentionally managed by the separate effect above to avoid session resets.
  useEffect(() => {
    if (!containerRef.current) return;

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
      return true;
    });

    try {
      fitAddon.fit();
    } catch {
      // Ignore initial fit calculation in JSDOM / zero-size
    }

    if (document.fonts) {
      document.fonts.ready.then(() => {
        if (!isDisposed && fitAddonRef.current) {
          try {
            fitAddonRef.current.fit();
          } catch {
            // Ignore
          }
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
    if (window.multissh?.terminalCreate && (local || config)) {
      const createOptions = local
        ? { local: true as const, ptyOptions: { cols, rows, shellType, wslDistro } }
        : { config: { ...(config as SSHConnectionConfig), id: crypto.randomUUID() }, ptyOptions: { cols, rows } };
      window.multissh
        .terminalCreate(createOptions)
        .then(({ sessionId }) => {
          if (isDisposed) {
            // Already unmounted while waiting for session creation
            window.multissh?.terminalKill(sessionId);
            return;
          }
          sessionIdRef.current = sessionId;

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
            if (sessionIdRef.current && window.multissh?.terminalWrite) {
              window.multissh.terminalWrite(sessionIdRef.current, data);
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
          if (window.multissh?.onTerminalData) {
            unsubData = window.multissh.onTerminalData((sessId, data) => {
              if (sessId === sessionIdRef.current) {
                term.write(data);
                sendInitialCwd();
                const detectedHost = scanOutputForHost(data);
                if (detectedHost) {
                  onTitleChangeRef.current?.(detectedHost);
                }
              }
            });
          }

          // 5. Exit from PTY
          if (window.multissh?.onTerminalExit) {
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
        if (!fitAddonRef.current || !termRef.current) return;
        // While the pane is `display: none` (inactive tab, or hidden split), its content box
        // is 0x0. fit() would compute a degenerate near-zero size (xterm clamps to a minimum
        // of 1x1) and push that to the real PTY, corrupting the shell's readline width tracking
        // until the pane is shown again. The "becomes active" effect re-syncs the real size then.
        if (!isActiveRef.current) return;
        try {
          fitAddonRef.current.fit();
          const newCols = termRef.current.cols;
          const newRows = termRef.current.rows;

          if (
            sessionIdRef.current &&
            (newCols !== lastColsRef.current || newRows !== lastRowsRef.current) &&
            newCols > 0 &&
            newRows > 0
          ) {
            lastColsRef.current = newCols;
            lastRowsRef.current = newRows;
            window.multissh?.terminalResize(sessionIdRef.current, newCols, newRows);
          }
        } catch {
          // Ignore resize errors when hidden
        }
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
      if (sid && window.multissh?.terminalKill) {
        window.multissh.terminalKill(sid);
      }
      term.dispose();
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }
      termRef.current = null;
      fitAddonRef.current = null;
      sessionIdRef.current = null;
    };
  }, [config, local, shellType, wslDistro, sessionKey]);

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
