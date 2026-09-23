import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Search, X } from 'lucide-react';
import type { SearchMatch, SearchMode, SearchSourceType } from '@shared/types/search';
import { SearchResultsList } from './SearchResultsList';
import { SearchPreviewPane } from './SearchPreviewPane';

interface SearchWarning {
  path?: string;
  message: string;
}

interface SearchModalProps {
  open: boolean;
  providerId: string;
  sourceType: SearchSourceType;
  rootPath: string;
  onClose: () => void;
  /** Navigates the owning pane to a match's containing folder and closes the search modal. */
  onJumpToFile?: (path: string) => void;
}

export const SearchModal: React.FC<SearchModalProps> = ({
  open,
  providerId,
  sourceType,
  rootPath,
  onClose,
  onJumpToFile,
}) => {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<SearchMode>('literal');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [includeGlobs, setIncludeGlobs] = useState('');
  const [excludeGlobs, setExcludeGlobs] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [searching, setSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [matches, setMatches] = useState<SearchMatch[]>([]);
  const [scannedCount, setScannedCount] = useState(0);
  const [currentPath, setCurrentPath] = useState<string | undefined>(undefined);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<SearchWarning[]>([]);
  const [warningsExpanded, setWarningsExpanded] = useState(false);
  const [selectedMatch, setSelectedMatch] = useState<SearchMatch | null>(null);

  const activeSearchIdRef = useRef<string | null>(null);
  const queryInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setTimeout(() => queryInputRef.current?.focus(), 50);
  }, [open]);

  useEffect(() => {
    const unsubResult = window.multissh.onSearchResult((event) => {
      if (event.searchId !== activeSearchIdRef.current) return;
      setMatches((prev) => [...prev, ...event.matches]);
    });
    const unsubProgress = window.multissh.onSearchProgress((event) => {
      if (event.searchId !== activeSearchIdRef.current) return;
      setScannedCount(event.scannedCount);
      setCurrentPath(event.currentPath);
    });
    const unsubError = window.multissh.onSearchError((event) => {
      if (event.searchId !== activeSearchIdRef.current) return;
      if (event.fatal) {
        setError(event.message);
      } else {
        setWarnings((prev) => [...prev, { path: event.path, message: event.message }]);
      }
    });
    const unsubDone = window.multissh.onSearchDone((event) => {
      if (event.searchId !== activeSearchIdRef.current) return;
      setSearching(false);
      setTruncated(event.truncated);
      setScannedCount(event.scannedCount);
      setCurrentPath(undefined);
      activeSearchIdRef.current = null;
    });
    return () => {
      unsubResult();
      unsubProgress();
      unsubError();
      unsubDone();
    };
  }, []);

  const stopActiveSearch = useCallback(() => {
    if (activeSearchIdRef.current) {
      void window.multissh.searchCancel(activeSearchIdRef.current);
      activeSearchIdRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!open) stopActiveSearch();
  }, [open, stopActiveSearch]);

  const handleSubmit = useCallback(
    async () => {
      if (!query.trim() || searching) return;

      stopActiveSearch();
      setMatches([]);
      setError(null);
      setWarnings([]);
      setWarningsExpanded(false);
      setTruncated(false);
      setScannedCount(0);
      setCurrentPath(undefined);
      setSelectedMatch(null);
      setSearching(true);
      setHasSearched(true);

      try {
        const { searchId } = await window.multissh.searchStart({
          providerId,
          sourceType,
          rootPath,
          query,
          mode,
          caseSensitive,
          includeGlobs: includeGlobs
            .split(',')
            .map((g) => g.trim())
            .filter(Boolean),
          excludeGlobs: excludeGlobs
            .split(',')
            .map((g) => g.trim())
            .filter(Boolean),
        });
        activeSearchIdRef.current = searchId;
      } catch (err) {
        setSearching(false);
        setError(err instanceof Error ? err.message : 'Failed to start search');
      }
    },
    [query, searching, providerId, sourceType, rootPath, mode, caseSensitive, includeGlobs, excludeGlobs, stopActiveSearch]
  );

  const handleCancel = useCallback(() => {
    stopActiveSearch();
    setSearching(false);
  }, [stopActiveSearch]);

  const handleClose = useCallback(() => {
    stopActiveSearch();
    onClose();
  }, [stopActiveSearch, onClose]);

  const handleJumpToFile = useCallback(
    (match: SearchMatch) => {
      onJumpToFile?.(match.path);
      handleClose();
    },
    [onJumpToFile, handleClose]
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm animate-in fade-in duration-150 p-4">
      <div className="flex h-[80vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-border-subtle bg-app-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-border-subtle bg-app-surface px-4 py-3">
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 text-sky-400" />
            <h2 className="text-sm font-semibold text-txt-primary">Search in Files — {rootPath}</h2>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="rounded-lg p-1 text-txt-muted hover:bg-app-surface-hover hover:text-txt-primary transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-2 border-b border-border-subtle bg-app-surface px-4 py-3">
          <div className="flex items-center gap-2">
            <input
              ref={queryInputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleSubmit();
                }
              }}
              placeholder="Search inside files..."
              className="flex-1 rounded-lg border border-border-subtle bg-app-input px-3 py-1.5 text-sm text-txt-primary outline-none focus:border-sky-500 placeholder-txt-muted"
            />
            {/* Always a plain button, never type="submit": swapping a button's type at
                the same screen position inside a <form> mid-click let Chromium treat a
                single click on "Cancel" as also submitting the form once React
                re-rendered it into the "Search" button — restarting the very search
                that click had just cancelled. Handling Enter and the click explicitly,
                with no <form> at all, removes that whole class of native-submit race. */}
            {searching ? (
              <button
                type="button"
                onClick={handleCancel}
                className="rounded-lg border border-border-subtle px-3.5 py-1.5 text-xs font-medium text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary transition-colors"
              >
                Cancel
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={!query.trim()}
                className="flex items-center gap-1.5 rounded-lg bg-sky-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-50 shadow-sm transition-colors"
              >
                {searching && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Search
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-txt-secondary">
            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <input
                type="radio"
                checked={mode === 'literal'}
                onChange={() => setMode('literal')}
                className="text-sky-500 focus:ring-0"
              />
              Literal
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <input
                type="radio"
                checked={mode === 'regex'}
                onChange={() => setMode('regex')}
                className="text-sky-500 focus:ring-0"
              />
              Regex
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={caseSensitive}
                onChange={(e) => setCaseSensitive(e.target.checked)}
                className="rounded border-border-subtle text-sky-500 focus:ring-0"
              />
              Case sensitive
            </label>
            <button
              type="button"
              onClick={() => setShowAdvanced((prev) => !prev)}
              className="ml-auto text-txt-muted hover:text-txt-primary transition-colors"
            >
              {showAdvanced ? 'Hide advanced' : 'Advanced...'}
            </button>
          </div>
          {showAdvanced && (
            <div className="flex flex-wrap items-center gap-3 text-xs text-txt-secondary">
              <label className="flex items-center gap-1.5">
                Include:
                <input
                  type="text"
                  value={includeGlobs}
                  onChange={(e) => setIncludeGlobs(e.target.value)}
                  placeholder="*.log, *.csv"
                  className="w-40 rounded-lg border border-border-subtle bg-app-input px-2 py-1 text-txt-primary outline-none focus:border-sky-500 placeholder-txt-muted"
                />
              </label>
              <label className="flex items-center gap-1.5">
                Exclude:
                <input
                  type="text"
                  value={excludeGlobs}
                  onChange={(e) => setExcludeGlobs(e.target.value)}
                  placeholder="*.min.js"
                  className="w-40 rounded-lg border border-border-subtle bg-app-input px-2 py-1 text-txt-primary outline-none focus:border-sky-500 placeholder-txt-muted"
                />
              </label>
            </div>
          )}
        </div>

        {error && (
          <div className="border-b border-red-900/60 bg-red-950/40 px-4 py-1.5 text-xs text-red-300">{error}</div>
        )}

        <div className="flex min-h-0 flex-1">
          <div className="flex w-1/3 min-w-[280px] flex-col border-r border-border-subtle">
            <div className="flex items-center justify-between border-b border-border-subtle bg-app-surface-subtle px-3 py-1.5 text-[11px] text-txt-muted">
              <span className="truncate">
                {matches.length} match{matches.length === 1 ? '' : 'es'} · {scannedCount} scanned
                {searching && currentPath ? ` · ${currentPath}` : ''}
              </span>
              {searching && <Loader2 className="h-3 w-3 shrink-0 animate-spin text-sky-400" />}
            </div>
            {truncated && (
              <div className="border-b border-amber-900/60 bg-amber-950/30 px-3 py-1 text-[11px] text-amber-300">
                Result limit reached — narrow your search to see more.
              </div>
            )}
            {warnings.length > 0 && (
              <div className="border-b border-amber-900/60 bg-amber-950/20 text-[11px] text-amber-300">
                <button
                  type="button"
                  onClick={() => setWarningsExpanded((prev) => !prev)}
                  className="flex w-full items-center justify-between px-3 py-1 hover:bg-amber-950/30"
                >
                  <span>
                    {warnings.length} warning{warnings.length === 1 ? '' : 's'} (skipped files/objects)
                  </span>
                  <span>{warningsExpanded ? '▲' : '▼'}</span>
                </button>
                {warningsExpanded && (
                  <ul className="max-h-24 overflow-y-auto border-t border-amber-900/40 px-3 py-1 space-y-0.5">
                    {warnings.map((w, i) => (
                      <li key={i} className="truncate">
                        {w.path ? <span className="font-mono">{w.path}: </span> : null}
                        {w.message}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            <SearchResultsList
              matches={matches}
              selectedMatchId={selectedMatch?.id ?? null}
              onSelect={setSelectedMatch}
              onJumpToFile={onJumpToFile ? handleJumpToFile : undefined}
              hasSearched={hasSearched}
            />
          </div>
          <SearchPreviewPane providerId={providerId} match={selectedMatch} />
        </div>
      </div>
    </div>
  );
};

export default SearchModal;
