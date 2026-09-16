import React, { useEffect, useState } from 'react';
import { pathSegments } from '../../lib/format';

interface BreadcrumbsProps {
  currentPath: string;
  onNavigate: (path: string) => void;
}

export const Breadcrumbs: React.FC<BreadcrumbsProps> = ({ currentPath, onNavigate }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(currentPath);

  useEffect(() => {
    setDraft(currentPath);
  }, [currentPath]);

  if (editing) {
    return (
      <form
        className="flex-1"
        onSubmit={(e) => {
          e.preventDefault();
          setEditing(false);
          if (draft.trim()) onNavigate(draft.trim());
        }}
      >
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setDraft(currentPath);
              setEditing(false);
            }
          }}
          className="w-full rounded-md border border-border-subtle bg-app-input px-2 py-1 text-xs text-txt-primary outline-none focus:border-sky-500 font-mono"
        />
      </form>
    );
  }

  const segments = pathSegments(currentPath);

  return (
    <div
      className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto rounded-md border border-transparent px-1 py-0.5 text-xs hover:border-border-subtle transition-colors cursor-pointer"
      onDoubleClick={() => setEditing(true)}
      title="Double-click to enter path"
    >
      {segments.map((segment, idx) => (
        <React.Fragment key={segment.path}>
          {idx > 0 && <span className="text-txt-muted opacity-50">/</span>}
          <button
            type="button"
            onClick={() => onNavigate(segment.path)}
            className="shrink-0 rounded px-1.5 py-0.5 text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary transition-colors font-medium"
          >
            {segment.label}
          </button>
        </React.Fragment>
      ))}
    </div>
  );
};

export default Breadcrumbs;
