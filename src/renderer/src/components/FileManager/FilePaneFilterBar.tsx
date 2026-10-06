import React from 'react';
import { Loader2, Search, X } from 'lucide-react';

interface FilePaneFilterBarProps {
  filterText: string;
  setFilterText: (text: string) => void;
  filterInputRef: React.RefObject<HTMLInputElement>;
  recursiveFilter: boolean;
  setRecursiveFilter: (recursive: boolean) => void;
  recursiveScanning: boolean;
  closeFilter: () => void;
}

/** The "filter files" row under the toolbar; Esc clears the text first and then closes the row. */
export const FilePaneFilterBar: React.FC<FilePaneFilterBarProps> = ({
  filterText,
  setFilterText,
  filterInputRef,
  recursiveFilter,
  setRecursiveFilter,
  recursiveScanning,
  closeFilter,
}) => (
  <div className="flex items-center gap-2 border-b border-divider bg-app-surface px-2.5 py-1">
    <Search className="h-3.5 w-3.5 shrink-0 text-txt-muted" />
    <input
      ref={filterInputRef}
      type="text"
      placeholder={
        recursiveFilter ? 'Search file names in this folder and subfolders... (Esc to close)' : 'Filter files in current folder... (Esc to close)'
      }
      value={filterText}
      onChange={(e) => setFilterText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          if (filterText) {
            setFilterText('');
          } else {
            closeFilter();
          }
        }
      }}
      className="flex-1 bg-transparent text-xs text-txt-primary placeholder-txt-muted outline-none"
    />
    {recursiveScanning && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-sky-400" />}
    <label
      className="flex shrink-0 cursor-pointer select-none items-center gap-1 text-2xs text-txt-secondary"
      title="Also search in all subfolders"
    >
      <input
        type="checkbox"
        checked={recursiveFilter}
        onChange={(e) => setRecursiveFilter(e.target.checked)}
        className="rounded border-border-subtle text-sky-500 focus:ring-0"
      />
      Recursive
    </label>
    {filterText && (
      <button
        type="button"
        title="Clear filter"
        aria-label="Clear filter"
        onClick={() => setFilterText('')}
        className="rounded p-0.5 text-txt-muted hover:text-txt-primary"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    )}
  </div>
);
