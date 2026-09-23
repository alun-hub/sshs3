import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import 'xterm/css/xterm.css';
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react';
import type { K8sTerminalTarget } from '@shared/types/kubernetes';

export interface K8sLogViewProps {
  target: K8sTerminalTarget;
  isActive?: boolean;
  fontSize?: number;
  fontFamily?: string;
}

/**
 * Read-only follow view for a container's logs, rendered as a full terminal
 * pane (not a small modal): resizes with the pane, supports xterm's normal
 * scrollback/selection, and has a search bar (Ctrl+F) via @xterm/addon-search.
 * Deliberately not TerminalView: there's no stdin and no PTY resize
 * negotiation, and the session lives on K8sLogManager's plain HTTP log
 * stream rather than the exec WebSocket.
 */
export const K8sLogView: React.FC<K8sLogViewProps> = ({
  target,
  isActive = true,
  fontSize = 13,
  fontFamily = 'Menlo, Monaco, "Courier New", monospace, Consolas',
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [ended, setEnded] = useState(false);

  useEffect(() => {
    if (isActive && searchOpen) {
      searchInputRef.current?.focus();
    }
  }, [isActive, searchOpen]);

  useEffect(() => {
    if (!containerRef.current) return;

    let isDisposed = false;
    let unsubData: (() => void) | null = null;
    let unsubEnd: (() => void) | null = null;
    let sessionId: string | null = null;

    const term = new Terminal({
      cursorBlink: false,
      disableStdin: true,
      convertEol: true,
      scrollback: 10000,
      fontSize,
      fontFamily,
      theme: { background: '#0f172a', foreground: '#f8fafc' },
    });
    const fitAddon = new FitAddon();
    const searchAddon = new SearchAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(searchAddon);
    searchAddonRef.current = searchAddon;
    term.open(containerRef.current);
    try {
      fitAddon.fit();
    } catch {
      // Ignore initial fit in a zero-size container
    }

    const resizeObserver =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            try {
              fitAddon.fit();
            } catch {
              // Ignore resize on a hidden/zero-size element
            }
          })
        : null;
    resizeObserver?.observe(containerRef.current);

    window.multissh
      .k8sLogStart(target, { tailLines: 1000, timestamps: false })
      .then(({ sessionId: id }) => {
        if (isDisposed) {
          window.multissh.k8sLogStop(id);
          return;
        }
        sessionId = id;

        unsubData = window.multissh.onK8sLogData((sessId, data) => {
          if (sessId === sessionId) term.write(data);
        });
        unsubEnd = window.multissh.onK8sLogEnd((sessId) => {
          if (sessId === sessionId) {
            term.write('\r\n\x1b[33m[Log stream ended]\x1b[0m\r\n');
            setEnded(true);
          }
        });
      })
      .catch((err) => {
        if (!isDisposed) {
          term.write(`\r\n\x1b[31mFailed to follow logs: ${err.message}\x1b[0m\r\n`);
        }
      });

    return () => {
      isDisposed = true;
      resizeObserver?.disconnect();
      unsubData?.();
      unsubEnd?.();
      if (sessionId) window.multissh.k8sLogStop(sessionId);
      term.dispose();
      if (containerRef.current) containerRef.current.innerHTML = '';
      searchAddonRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.contextName, target.namespace, target.podName, target.containerName]);

  // Re-fit when the pane becomes visible/active again (same rationale as TerminalView).
  useEffect(() => {
    if (isActive) {
      // Give the layout a tick to settle (pane just became display:flex again).
      const id = requestAnimationFrame(() => {
        containerRef.current?.dispatchEvent(new Event('resize'));
      });
      return () => cancelAnimationFrame(id);
    }
    return undefined;
  }, [isActive]);

  const runSearch = (direction: 'next' | 'previous') => {
    if (!searchQuery) return;
    const addon = searchAddonRef.current;
    if (!addon) return;
    if (direction === 'next') addon.findNext(searchQuery);
    else addon.findPrevious(searchQuery);
  };

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-[#0f172a]">
      {searchOpen && (
        <div className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-lg border border-border-subtle bg-app-card px-2 py-1 shadow-lg">
          <Search className="h-3.5 w-3.5 text-txt-muted" />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              if (e.target.value) searchAddonRef.current?.findNext(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') runSearch(e.shiftKey ? 'previous' : 'next');
              if (e.key === 'Escape') setSearchOpen(false);
            }}
            placeholder="Search logs..."
            className="w-40 bg-transparent text-xs text-txt-primary outline-none placeholder-txt-muted"
          />
          <button
            type="button"
            title="Previous match (Shift+Enter)"
            onClick={() => runSearch('previous')}
            className="rounded p-0.5 text-txt-muted hover:bg-app-surface-hover hover:text-txt-primary transition-colors"
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            title="Next match (Enter)"
            onClick={() => runSearch('next')}
            className="rounded p-0.5 text-txt-muted hover:bg-app-surface-hover hover:text-txt-primary transition-colors"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            title="Close search (Esc)"
            onClick={() => setSearchOpen(false)}
            className="rounded p-0.5 text-txt-muted hover:bg-app-surface-hover hover:text-txt-primary transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {!searchOpen && (
        <button
          type="button"
          title="Search logs (Ctrl+F)"
          onClick={() => setSearchOpen(true)}
          className="absolute right-2 top-2 z-10 rounded-lg border border-border-subtle bg-app-card p-1.5 text-txt-muted hover:bg-app-surface-hover hover:text-txt-primary shadow-sm transition-colors"
        >
          <Search className="h-3.5 w-3.5" />
        </button>
      )}

      <div
        ref={containerRef}
        data-testid="k8s-log-container"
        className="min-h-0 flex-1 p-2"
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
            e.preventDefault();
            setSearchOpen(true);
          }
        }}
        tabIndex={-1}
      />

      {ended && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-lg bg-slate-900/90 border border-slate-700/80 px-3 py-1.5 text-xs text-amber-300 shadow-lg">
          Log stream ended
        </div>
      )}
    </div>
  );
};

export default K8sLogView;
