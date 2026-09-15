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
          className="w-full rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-slate-100 outline-none focus:border-sky-500"
        />
      </form>
    );
  }

  const segments = pathSegments(currentPath);

  return (
    <div
      className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto rounded border border-transparent px-1 py-1 text-sm hover:border-slate-700"
      onDoubleClick={() => setEditing(true)}
      title="Dubbelklicka för att skriva in en sökväg"
    >
      {segments.map((segment, idx) => (
        <React.Fragment key={segment.path}>
          {idx > 0 && <span className="text-slate-600">/</span>}
          <button
            type="button"
            onClick={() => onNavigate(segment.path)}
            className="shrink-0 rounded px-1.5 py-0.5 text-slate-300 hover:bg-slate-700 hover:text-slate-50"
          >
            {segment.label}
          </button>
        </React.Fragment>
      ))}
    </div>
  );
};

export default Breadcrumbs;
