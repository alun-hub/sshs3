import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Check,
  Code,
  ExternalLink,
  FileText,
  Lock,
  Loader2,
  Maximize2,
  Minimize2,
  RotateCw,
  Save,
  Search,
  Terminal,
  Unlock,
  WrapText,
  X,
} from 'lucide-react';
import type { FileEntry } from '@shared/types/storage';
import type { ExternalFileStatusEvent, FileReadResult } from '@shared/types/ipc';
import { classNames, formatBytes, formatDateTime } from '../../lib/format';
import type { SourceType } from './types';

interface FileEditorModalProps {
  open: boolean;
  providerId: string;
  sourceType: SourceType;
  entry: FileEntry | null;
  isTailMode?: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

export const FileEditorModal: React.FC<FileEditorModalProps> = ({
  open,
  providerId,
  sourceType,
  entry,
  isTailMode = false,
  onClose,
  onSaved,
}) => {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [isBinary, setIsBinary] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [wordWrap, setWordWrap] = useState(true);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [isMaximized, setIsMaximized] = useState(false);

  // Tail state
  const [tailModeActive, setTailModeActive] = useState(false);
  const [tailId, setTailId] = useState<string | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // Search state
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentMatchIdx, setCurrentMatchIdx] = useState(0);

  // Cursor position
  const [cursorPos, setCursorPos] = useState({ line: 1, col: 1 });

  // External editor state
  const [externalSessionToken, setExternalSessionToken] = useState<string | null>(null);
  const [externalStatus, setExternalStatus] = useState<string | null>(null);
  const [externalLaunching, setExternalLaunching] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const isDirty = useMemo(
    () => !tailModeActive && content !== originalContent,
    [tailModeActive, content, originalContent]
  );

  // Stop tail session helper
  const stopTailSession = useCallback(async () => {
    if (tailId) {
      await window.multissh?.fileTailStop?.(tailId);
      setTailId(null);
    }
    setTailModeActive(false);
  }, [tailId]);

  // Load file content normally
  const loadFile = useCallback(async () => {
    if (!entry || entry.isDirectory) return;
    await stopTailSession();
    setLoading(true);
    setError(null);
    setSaveStatus(null);
    try {
      const res: FileReadResult = await window.multissh.fileRead(providerId, entry.path);
      setContent(res.content);
      setOriginalContent(res.content);
      setIsBinary(res.isBinary);
      setTruncated(res.truncated);
      setReadOnly(res.isBinary);
    } catch (err: any) {
      setError(err instanceof Error ? err.message : 'Failed to load file content');
    } finally {
      setLoading(false);
    }
  }, [providerId, entry, stopTailSession]);

  // Start tail session
  const startTailSession = useCallback(async () => {
    if (!entry || entry.isDirectory) return;
    setLoading(true);
    setError(null);
    setSaveStatus(null);
    setTailModeActive(true);
    setReadOnly(true);

    if (tailId) {
      await window.multissh?.fileTailStop?.(tailId);
      setTailId(null);
    }

    try {
      const res = await window.multissh.fileTailStart(providerId, entry.path);
      setTailId(res.tailId);
      setContent(res.initialContent);
      setOriginalContent(res.initialContent);
      setIsBinary(false);
      setTruncated(false);

      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.scrollTop = textareaRef.current.scrollHeight;
        }
      }, 50);
    } catch (err: any) {
      setError(err instanceof Error ? err.message : 'Failed to start live log stream');
      setTailModeActive(false);
    } finally {
      setLoading(false);
    }
  }, [providerId, entry, tailId]);

  // Open modal effect
  useEffect(() => {
    if (!open || !entry) {
      setContent('');
      setOriginalContent('');
      setError(null);
      setSaveStatus(null);
      setExternalStatus(null);
      setTailModeActive(false);
      if (tailId) {
        void window.multissh?.fileTailStop?.(tailId);
        setTailId(null);
      }
      if (externalSessionToken) {
        void window.multissh?.fileCloseExternal?.(externalSessionToken);
        setExternalSessionToken(null);
      }
      return;
    }

    if (isTailMode) {
      void startTailSession();
    } else {
      void loadFile();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, entry, isTailMode, providerId]);

  // Tail data stream listener
  useEffect(() => {
    if (!open || !tailModeActive || !tailId || !window.multissh?.onFileTailData) return;

    const dataCleanup = window.multissh.onFileTailData((event) => {
      if (event.tailId === tailId) {
        setContent((prev) => prev + event.chunk);
        if (autoScroll) {
          setTimeout(() => {
            if (textareaRef.current) {
              textareaRef.current.scrollTop = textareaRef.current.scrollHeight;
            }
          }, 10);
        }
      }
    });

    const errorCleanup = window.multissh.onFileTailError?.((event) => {
      if (event.tailId === tailId) {
        setError(`Tail error: ${event.error}`);
      }
    });

    return () => {
      dataCleanup();
      errorCleanup?.();
    };
  }, [open, tailModeActive, tailId, autoScroll]);

  // External editor status listener
  useEffect(() => {
    if (!open || !window.multissh?.onExternalFileStatus) return;

    const cleanup = window.multissh.onExternalFileStatus((event: ExternalFileStatusEvent) => {
      if (event.sessionToken === externalSessionToken || event.remotePath === entry?.path) {
        if (event.status === 'uploaded') {
          setSaveStatus(`Uploaded from external editor at ${event.timestamp}`);
          setExternalStatus(`Auto-uploaded from external editor at ${event.timestamp}`);
          void loadFile();
          onSaved?.();
        } else if (event.status === 'error') {
          setError(`External editor upload failed: ${event.error}`);
        }
      }
    });

    return () => cleanup();
  }, [open, externalSessionToken, entry?.path, loadFile, onSaved]);

  // Sync scroll & auto-scroll tracking
  const handleScroll = useCallback(() => {
    if (textareaRef.current) {
      if (lineNumbersRef.current) {
        lineNumbersRef.current.scrollTop = textareaRef.current.scrollTop;
      }
      if (tailModeActive) {
        const el = textareaRef.current;
        const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        setAutoScroll(isNearBottom);
      }
    }
  }, [tailModeActive]);

  // Track cursor line & col
  const updateCursorPosition = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    const pos = el.selectionStart;
    const textBefore = el.value.slice(0, pos);
    const lines = textBefore.split('\n');
    const line = lines.length;
    const col = lines[lines.length - 1].length + 1;
    setCursorPos({ line, col });
  }, []);

  // Save file content
  const handleSave = useCallback(async () => {
    if (!entry || readOnly || saving || tailModeActive) return;
    setSaving(true);
    setError(null);
    try {
      await window.multissh.fileSave(providerId, entry.path, content);
      setOriginalContent(content);
      const timestamp = formatDateTime(new Date());
      setSaveStatus(`Saved at ${timestamp}`);
      onSaved?.();
    } catch (err: any) {
      setError(err instanceof Error ? err.message : 'Failed to save file');
    } finally {
      setSaving(false);
    }
  }, [providerId, entry, content, readOnly, saving, tailModeActive, onSaved]);

  // Launch external editor
  const handleOpenExternal = useCallback(async () => {
    if (!entry) return;
    setExternalLaunching(true);
    setError(null);
    try {
      const res = await window.multissh.fileOpenExternal(providerId, entry.path);
      setExternalSessionToken(res.sessionToken);
      setExternalStatus('External editor active — auto-uploading on save');
    } catch (err: any) {
      setError(err instanceof Error ? err.message : 'Failed to open external editor');
    } finally {
      setExternalLaunching(false);
    }
  }, [providerId, entry]);

  // Close confirmation if dirty
  const handleRequestClose = useCallback(() => {
    if (isDirty && !tailModeActive) {
      if (!window.confirm('You have unsaved changes. Discard them?')) {
        return;
      }
    }
    if (tailId) {
      void window.multissh?.fileTailStop?.(tailId);
      setTailId(null);
    }
    if (externalSessionToken) {
      void window.multissh?.fileCloseExternal?.(externalSessionToken);
      setExternalSessionToken(null);
    }
    onClose();
  }, [isDirty, tailModeActive, tailId, externalSessionToken, onClose]);

  // Global Escape key handling
  useEffect(() => {
    if (!open) return;
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showSearch) {
          setShowSearch(false);
          return;
        }
        handleRequestClose();
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [open, showSearch, handleRequestClose]);

  // Textarea key handling
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void handleSave();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setShowSearch(true);
        setTimeout(() => searchInputRef.current?.focus(), 50);
        return;
      }

      if (e.key === 'Tab' && !readOnly) {
        e.preventDefault();
        const el = textareaRef.current;
        if (!el) return;
        const start = el.selectionStart;
        const end = el.selectionEnd;
        const insertText = '  ';
        const newText = el.value.slice(0, start) + insertText + el.value.slice(end);
        setContent(newText);
        setTimeout(() => {
          el.selectionStart = el.selectionEnd = start + insertText.length;
          updateCursorPosition();
        }, 0);
      }
    },
    [handleSave, readOnly, updateCursorPosition]
  );

  // Search logic
  const searchMatches = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const query = searchQuery.toLowerCase();
    const matches: number[] = [];
    let pos = 0;
    const lowerContent = content.toLowerCase();
    while ((pos = lowerContent.indexOf(query, pos)) !== -1) {
      matches.push(pos);
      pos += query.length;
    }
    return matches;
  }, [content, searchQuery]);

  const handleSearchNext = useCallback(() => {
    if (searchMatches.length === 0) return;
    const nextIdx = (currentMatchIdx + 1) % searchMatches.length;
    setCurrentMatchIdx(nextIdx);
    const matchPos = searchMatches[nextIdx];
    const el = textareaRef.current;
    if (el) {
      el.focus();
      el.setSelectionRange(matchPos, matchPos + searchQuery.length);
      updateCursorPosition();
    }
  }, [searchMatches, currentMatchIdx, searchQuery, updateCursorPosition]);

  const handleSearchPrev = useCallback(() => {
    if (searchMatches.length === 0) return;
    const prevIdx = (currentMatchIdx - 1 + searchMatches.length) % searchMatches.length;
    setCurrentMatchIdx(prevIdx);
    const matchPos = searchMatches[prevIdx];
    const el = textareaRef.current;
    if (el) {
      el.focus();
      el.setSelectionRange(matchPos, matchPos + searchQuery.length);
      updateCursorPosition();
    }
  }, [searchMatches, currentMatchIdx, searchQuery, updateCursorPosition]);

  // Line count
  const lineCount = useMemo(() => {
    return Math.max(1, content.split('\n').length);
  }, [content]);

  if (!open || !entry) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Editing ${entry.name}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-3 sm:p-5 animate-in fade-in duration-150"
    >
      <div
        className={classNames(
          'flex flex-col rounded-xl border border-border-subtle bg-app-card shadow-2xl overflow-hidden transition-all duration-150',
          isMaximized ? 'w-[98vw] h-[96vh] max-w-none' : 'w-[94vw] max-w-[1500px] h-[88vh]'
        )}
      >
        {/* Header */}
        <div
          onDoubleClick={() => setIsMaximized((m) => !m)}
          title="Double-click header to maximize / restore"
          className="flex items-center justify-between border-b border-border-subtle bg-app-surface px-4 py-2.5 select-none shrink-0 cursor-default"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <FileText className="h-4 w-4 text-sky-400 shrink-0" />
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-sm font-semibold text-txt-primary truncate">
                {entry.name}
              </span>
              <span className="rounded bg-app-surface-subtle px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider text-txt-muted">
                {sourceType}
              </span>
              {isDirty ? (
                <span className="flex items-center gap-1 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
                  Unsaved changes
                </span>
              ) : (
                saveStatus && (
                  <span className="flex items-center gap-1 rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400">
                    <Check className="h-3 w-3" />
                    Saved
                  </span>
                )
              )}
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-1">
            {/* Tail -f Toggle */}
            <button
              type="button"
              title={tailModeActive ? 'Stop Tail -f' : 'Start Tail -f (Live log stream)'}
              onClick={() => {
                if (tailModeActive) {
                  void stopTailSession();
                  void loadFile();
                } else {
                  void startTailSession();
                }
              }}
              className={classNames(
                'flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold transition-colors',
                tailModeActive
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 animate-pulse'
                  : 'text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary'
              )}
            >
              <Terminal className="h-3.5 w-3.5" />
              <span>{tailModeActive ? 'TAILING...' : 'Tail -f'}</span>
            </button>

            {/* Search Toggle */}
            <button
              type="button"
              title="Search (Ctrl+F)"
              onClick={() => {
                setShowSearch((prev) => {
                  const next = !prev;
                  if (next) setTimeout(() => searchInputRef.current?.focus(), 50);
                  return next;
                });
              }}
              className={classNames(
                'rounded-lg p-1.5 transition-colors',
                showSearch
                  ? 'bg-sky-500/20 text-sky-400'
                  : 'text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary'
              )}
            >
              <Search className="h-4 w-4" />
            </button>

            {/* Word wrap toggle */}
            <button
              type="button"
              title={wordWrap ? 'Disable Word Wrap' : 'Enable Word Wrap'}
              onClick={() => setWordWrap((w) => !w)}
              className={classNames(
                'rounded-lg p-1.5 transition-colors',
                wordWrap
                  ? 'bg-sky-500/20 text-sky-400'
                  : 'text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary'
              )}
            >
              <WrapText className="h-4 w-4" />
            </button>

            {/* Read-only toggle */}
            <button
              type="button"
              disabled={tailModeActive}
              title={
                tailModeActive
                  ? 'Read-only during Tail -f mode'
                  : readOnly
                  ? 'Switch to Edit Mode'
                  : 'Switch to Read-Only Mode'
              }
              onClick={() => setReadOnly((r) => !r)}
              className={classNames(
                'rounded-lg p-1.5 transition-colors disabled:opacity-40',
                readOnly
                  ? 'text-amber-400 hover:bg-app-surface-hover'
                  : 'text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary'
              )}
            >
              {readOnly ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
            </button>

            {/* Reload from server */}
            <button
              type="button"
              title="Reload from storage"
              disabled={loading || saving}
              onClick={() => {
                if (isDirty && !window.confirm('Discard unsaved changes and reload?')) return;
                if (tailModeActive) {
                  void startTailSession();
                } else {
                  void loadFile();
                }
              }}
              className="rounded-lg p-1.5 text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary disabled:opacity-40 transition-colors"
            >
              <RotateCw className={classNames('h-4 w-4', loading && 'animate-spin text-sky-400')} />
            </button>

            {/* Open in external editor */}
            <button
              type="button"
              title="Open in External Editor (auto-uploads on save)"
              disabled={externalLaunching || loading}
              onClick={() => void handleOpenExternal()}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium text-txt-primary hover:bg-app-surface-hover transition-colors"
            >
              {externalLaunching ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-400" />
              ) : (
                <ExternalLink className="h-3.5 w-3.5 text-sky-400" />
              )}
              <span className="hidden sm:inline">External Editor</span>
            </button>

            {/* Save button */}
            <button
              type="button"
              title="Save changes (Ctrl+S)"
              disabled={!isDirty || readOnly || saving || loading || tailModeActive}
              onClick={() => void handleSave()}
              className="flex items-center gap-1.5 rounded-lg bg-sky-500 px-3 py-1 text-xs font-semibold text-white shadow-sm hover:bg-sky-400 disabled:opacity-40 transition-colors ml-1"
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              <span>Save</span>
            </button>

            {/* Maximize / Restore toggle */}
            <button
              type="button"
              title={isMaximized ? 'Restore size' : 'Maximize editor'}
              onClick={() => setIsMaximized((m) => !m)}
              className="rounded-lg p-1.5 text-txt-muted hover:bg-app-surface-hover hover:text-txt-primary transition-colors ml-1"
            >
              {isMaximized ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </button>

            {/* Close button */}
            <button
              type="button"
              title="Close editor (Esc)"
              onClick={handleRequestClose}
              className="rounded-lg p-1.5 text-txt-muted hover:bg-app-surface-hover hover:text-txt-primary transition-colors ml-1"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Path Subheader */}
        <div className="flex items-center justify-between border-b border-border-subtle bg-app-surface/60 px-4 py-1 text-[11px] text-txt-muted">
          <span className="font-mono truncate">{entry.path}</span>
          <span className="shrink-0">{formatBytes(entry.size)}</span>
        </div>

        {/* Tail Mode Banner */}
        {tailModeActive && (
          <div className="flex items-center justify-between border-b border-emerald-900/60 bg-emerald-950/40 px-3 py-1.5 text-xs text-emerald-300">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
              <span className="font-semibold">TAIL -F STREAM ACTIVE</span>
              <span className="text-[11px] opacity-80">
                ({autoScroll ? 'Auto-scrolling' : 'Auto-scroll paused (scroll down to bottom to resume)'})
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                void stopTailSession();
                void loadFile();
              }}
              className="rounded bg-emerald-900/60 px-2 py-0.5 text-[11px] font-medium text-emerald-200 hover:bg-emerald-800/80"
            >
              Stop Stream
            </button>
          </div>
        )}

        {/* Large File Warning Banner (>20MB) */}
        {!tailModeActive && entry.size > 20 * 1024 * 1024 && (
          <div className="flex items-center justify-between gap-2 border-b border-amber-900/60 bg-amber-950/40 px-3 py-1.5 text-xs text-amber-300">
            <div className="flex items-center gap-1.5">
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
              <span>
                Large file ({formatBytes(entry.size)}). Loading the full file may freeze the app. Consider using Tail -f mode.
              </span>
            </div>
            <button
              type="button"
              onClick={() => void startTailSession()}
              className="rounded bg-amber-800/50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-200 hover:bg-amber-700/60 shrink-0"
            >
              Switch to Tail -f
            </button>
          </div>
        )}

        {/* In-Editor Search Bar */}
        {showSearch && (
          <div className="flex items-center gap-2 border-b border-border-subtle bg-app-surface px-3 py-1.5 select-none">
            <Search className="h-3.5 w-3.5 text-txt-muted shrink-0" />
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Find in file... (Enter for next, Esc to close)"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentMatchIdx(0);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (e.shiftKey) handleSearchPrev();
                  else handleSearchNext();
                }
                if (e.key === 'Escape') {
                  setShowSearch(false);
                  textareaRef.current?.focus();
                }
              }}
              className="flex-1 bg-transparent text-xs text-txt-primary placeholder-txt-muted outline-none"
            />
            {searchQuery && (
              <span className="text-[11px] text-txt-muted px-1">
                {searchMatches.length > 0
                  ? `${currentMatchIdx + 1} of ${searchMatches.length}`
                  : 'No matches'}
              </span>
            )}
            <button
              type="button"
              onClick={handleSearchPrev}
              disabled={searchMatches.length === 0}
              className="rounded px-1.5 py-0.5 text-xs text-txt-secondary hover:bg-app-surface-hover disabled:opacity-40"
            >
              Prev
            </button>
            <button
              type="button"
              onClick={handleSearchNext}
              disabled={searchMatches.length === 0}
              className="rounded px-1.5 py-0.5 text-xs text-txt-secondary hover:bg-app-surface-hover disabled:opacity-40"
            >
              Next
            </button>
            <button
              type="button"
              onClick={() => {
                setShowSearch(false);
                textareaRef.current?.focus();
              }}
              className="rounded p-1 text-txt-muted hover:text-txt-primary"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Error banner */}
        {error && (
          <div className="flex items-center justify-between gap-2 border-b border-red-900/60 bg-red-950/40 px-3 py-1.5 text-xs text-red-300">
            <div className="flex items-center gap-1.5 truncate">
              <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />
              <span className="truncate">{error}</span>
            </div>
            <button
              type="button"
              onClick={() => setError(null)}
              className="rounded p-0.5 hover:bg-red-900/40 text-red-300"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}

        {/* Binary warning banner */}
        {isBinary && (
          <div className="flex items-center justify-between gap-2 border-b border-amber-900/60 bg-amber-950/40 px-3 py-1.5 text-xs text-amber-300">
            <div className="flex items-center gap-1.5">
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
              <span>
                Binary file detected. Plain text view might not render properly.
              </span>
            </div>
            <button
              type="button"
              onClick={() => void handleOpenExternal()}
              className="rounded bg-amber-800/40 px-2 py-0.5 text-[11px] font-semibold text-amber-200 hover:bg-amber-700/50"
            >
              Open in External App
            </button>
          </div>
        )}

        {/* Truncated warning banner */}
        {truncated && !tailModeActive && (
          <div className="flex items-center gap-1.5 border-b border-amber-900/60 bg-amber-950/40 px-3 py-1.5 text-xs text-amber-300">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
            <span>File exceeds 5 MB. Displaying the first 5 MB.</span>
          </div>
        )}

        {/* External editor status banner */}
        {externalStatus && (
          <div className="flex items-center justify-between gap-2 border-b border-sky-900/60 bg-sky-950/40 px-3 py-1.5 text-xs text-sky-300">
            <div className="flex items-center gap-1.5">
              <Code className="h-4 w-4 shrink-0 text-sky-400" />
              <span>{externalStatus}</span>
            </div>
            <button
              type="button"
              onClick={() => setExternalStatus(null)}
              className="rounded p-0.5 hover:bg-sky-900/40 text-sky-300"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}

        {/* Editor Body */}
        <div className="relative flex-1 min-h-0 flex bg-app-card overflow-hidden">
          {loading ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-2 text-txt-muted text-sm">
              <Loader2 className="h-6 w-6 animate-spin text-sky-400" />
              <span>{tailModeActive ? 'Starting Tail -f stream...' : 'Loading file...'}</span>
            </div>
          ) : (
            <>
              {/* Line Numbers Gutter */}
              <div
                ref={lineNumbersRef}
                aria-hidden="true"
                className="w-12 sm:w-14 shrink-0 select-none bg-app-surface border-r border-border-subtle text-right font-mono text-xs leading-5 text-txt-muted py-2.5 pr-2.5 overflow-hidden"
              >
                {Array.from({ length: lineCount }, (_, i) => (
                  <div key={i + 1} className="h-5 leading-5">
                    {i + 1}
                  </div>
                ))}
              </div>

              {/* Text Area */}
              <textarea
                ref={textareaRef}
                value={content}
                readOnly={readOnly || saving || tailModeActive}
                spellCheck={false}
                wrap={wordWrap ? 'soft' : 'off'}
                onChange={(e) => {
                  setContent(e.target.value);
                  updateCursorPosition();
                }}
                onScroll={handleScroll}
                onClick={updateCursorPosition}
                onKeyUp={updateCursorPosition}
                onSelect={updateCursorPosition}
                onKeyDown={handleKeyDown}
                className={classNames(
                  'flex-1 h-full w-full bg-transparent p-2.5 font-mono text-xs leading-5 text-txt-primary outline-none resize-none overflow-auto border-none select-text',
                  (readOnly || tailModeActive) && 'opacity-90'
                )}
                placeholder="Empty file"
              />
            </>
          )}
        </div>

        {/* Status Bar */}
        <div className="flex items-center justify-between border-t border-border-subtle bg-app-surface px-3 py-1.5 text-[11px] text-txt-muted select-none shrink-0 font-mono">
          <div className="flex items-center gap-3">
            <span>
              Ln {cursorPos.line}, Col {cursorPos.col}
            </span>
            <span>{lineCount} lines</span>
            <span>{content.length} chars</span>
          </div>

          <div className="flex items-center gap-3">
            {saveStatus && (
              <span className="text-txt-secondary">{saveStatus}</span>
            )}
            <span
              className={classNames(
                'font-sans uppercase text-[10px] font-semibold px-1.5 py-0.5 rounded',
                tailModeActive
                  ? 'bg-emerald-500/20 text-emerald-400'
                  : readOnly
                  ? 'bg-amber-500/20 text-amber-400'
                  : 'bg-sky-500/20 text-sky-400'
              )}
            >
              {tailModeActive ? 'Tail -f' : readOnly ? 'Read-Only' : 'Edit'}
            </span>
            <span>UTF-8</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FileEditorModal;
