import React, { useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from '@xterm/addon-fit';
import 'xterm/css/xterm.css';
import type { SSHConnectionConfig, SSHPtyExitEvent } from '@shared/types/ssh';

export interface TerminalViewProps {
  config: SSHConnectionConfig;
  isActive?: boolean;
  onExit?: (event: SSHPtyExitEvent) => void;
  className?: string;
  fontSize?: number;
  fontFamily?: string;
  theme?: 'dark' | 'light' | 'system';
}

const XTERM_LIGHT_THEME = {
  background: '#ffffff',
  foreground: '#0f172a',
  cursor: '#0284c7',
  cursorAccent: '#ffffff',
  selectionBackground: '#cbd5e1',
  black: '#000000',
  red: '#dc2626',
  green: '#16a34a',
  yellow: '#ca8a04',
  blue: '#0284c7',
  magenta: '#9333ea',
  cyan: '#0891b2',
  white: '#f8fafc',
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

export const TerminalView: React.FC<TerminalViewProps> = ({
  config,
  isActive = true,
  onExit,
  className = '',
  fontSize = 13,
  fontFamily = 'Menlo, Monaco, "Courier New", monospace, Consolas',
  theme = 'dark',
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;

  // Focus and fit when becoming active
  useEffect(() => {
    if (isActive && fitAddonRef.current && termRef.current) {
      try {
        fitAddonRef.current.fit();
        termRef.current.focus();
      } catch {
        // Safe to ignore resize on hidden element
      }
    }
  }, [isActive]);

  // Update terminal options when props change
  useEffect(() => {
    if (termRef.current) {
      termRef.current.options.fontSize = fontSize;
      termRef.current.options.fontFamily = fontFamily;
      const isLight =
        theme === 'light' ||
        (theme === 'system' && Boolean(window.matchMedia?.('(prefers-color-scheme: light)')?.matches));
      termRef.current.options.theme = isLight ? XTERM_LIGHT_THEME : XTERM_DARK_THEME;
      try {
        fitAddonRef.current?.fit();
      } catch {
        // Safe to ignore initial fit in hidden elements
      }
    }
  }, [fontSize, fontFamily, theme]);

  useEffect(() => {
    if (!containerRef.current) return;

    let isDisposed = false;
    let unsubData: (() => void) | null = null;
    let unsubExit: (() => void) | null = null;
    let resizeObserver: ResizeObserver | null = null;

    const isLight =
      theme === 'light' ||
      (theme === 'system' && Boolean(window.matchMedia?.('(prefers-color-scheme: light)')?.matches));

    // 1. Initialize Terminal & FitAddon
    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontSize,
      fontFamily,
      theme: isLight ? XTERM_LIGHT_THEME : XTERM_DARK_THEME,
      allowProposedApi: true,
    });
    termRef.current = term;

    const fitAddon = new FitAddon();
    fitAddonRef.current = fitAddon;
    term.loadAddon(fitAddon);

    term.open(containerRef.current);

    try {
      fitAddon.fit();
    } catch {
      // Ignore initial fit calculation in JSDOM / zero-size
    }

    const cols = term.cols || 80;
    const rows = term.rows || 24;
    let lastCols = cols;
    let lastRows = rows;

    // 2. Create Terminal Session via IPC
    // Always spawn under a fresh session id, never the saved profile's own id:
    // reusing it would let two mounts of the same profile (two tabs, or React
    // StrictMode's dev-mode double-invoke) collide on the same map entry in
    // SSHPtyManager, so killing one session tears down the other instead.
    if (window.multissh?.terminalCreate) {
      const sessionConfig = { ...config, id: crypto.randomUUID() };
      window.multissh
        .terminalCreate({ config: sessionConfig, ptyOptions: { cols, rows } })
        .then(({ sessionId }) => {
          if (isDisposed) {
            // Already unmounted while waiting for session creation
            window.multissh?.terminalKill(sessionId);
            return;
          }
          sessionIdRef.current = sessionId;

          // 3. User input to PTY
          term.onData((data) => {
            if (sessionIdRef.current && window.multissh?.terminalWrite) {
              window.multissh.terminalWrite(sessionIdRef.current, data);
            }
          });

          // 4. Data from PTY to xterm
          if (window.multissh?.onTerminalData) {
            unsubData = window.multissh.onTerminalData((sessId, data) => {
              if (sessId === sessionIdRef.current) {
                term.write(data);
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
              }
            });
          }
        })
        .catch((err) => {
          if (!isDisposed) {
            term.write(`\r\n\x1b[31mFailed to start terminal session: ${err.message}\x1b[0m\r\n`);
          }
        });
    }

    // 6. Handle Resize
    if (typeof ResizeObserver !== 'undefined' && containerRef.current) {
      resizeObserver = new ResizeObserver(() => {
        if (!fitAddonRef.current || !termRef.current) return;
        try {
          fitAddonRef.current.fit();
          const newCols = termRef.current.cols;
          const newRows = termRef.current.rows;

          if (
            sessionIdRef.current &&
            (newCols !== lastCols || newRows !== lastRows) &&
            newCols > 0 &&
            newRows > 0
          ) {
            lastCols = newCols;
            lastRows = newRows;
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
      const sid = sessionIdRef.current;
      if (sid && window.multissh?.terminalKill) {
        window.multissh.terminalKill(sid);
      }
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
      sessionIdRef.current = null;
    };
  }, [config]);

  return (
    <div
      data-testid="terminal-view"
      className={`relative h-full w-full overflow-hidden bg-slate-900 ${className}`}
    >
      <div
        ref={containerRef}
        data-testid="terminal-container"
        className="h-full w-full p-2 focus:outline-none"
      />
    </div>
  );
};
