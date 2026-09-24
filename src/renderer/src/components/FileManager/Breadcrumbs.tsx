import React, { useCallback, useEffect, useRef, useState } from 'react';
import { classNames, pathSegments } from '../../lib/format';

interface BreadcrumbsProps {
  currentPath: string;
  onNavigate: (path: string) => void;
  onDropToPath?: (targetPath: string, e: React.DragEvent) => void;
}

export const Breadcrumbs: React.FC<BreadcrumbsProps> = ({ currentPath, onNavigate, onDropToPath }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(currentPath);
  const [dragOverSegment, setDragOverSegment] = useState<string | null>(null);

  const springTimerRef = useRef<NodeJS.Timeout | null>(null);
  const springTargetRef = useRef<string | null>(null);

  const clearSpringTimer = useCallback(() => {
    if (springTimerRef.current) {
      clearTimeout(springTimerRef.current);
      springTimerRef.current = null;
    }
    springTargetRef.current = null;
  }, []);

  useEffect(() => {
    setDraft(currentPath);
  }, [currentPath]);

  useEffect(() => {
    return () => {
      clearSpringTimer();
    };
  }, [clearSpringTimer]);

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
      title="Double-click to enter path, or drop files on any folder"
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDragEnter={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        clearSpringTimer();
        setDragOverSegment(null);
        onDropToPath?.(currentPath, e);
      }}
    >
      {segments.map((segment, idx) => {
        const isHovered = dragOverSegment === segment.path;
        return (
          <React.Fragment key={segment.path}>
            {idx > 0 && <span className="text-txt-muted opacity-50">/</span>}
            <button
              type="button"
              onClick={() => onNavigate(segment.path)}
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
                e.dataTransfer.dropEffect = 'copy';
                setDragOverSegment(segment.path);
                if (segment.path !== currentPath && springTargetRef.current !== segment.path) {
                  clearSpringTimer();
                  springTargetRef.current = segment.path;
                  springTimerRef.current = setTimeout(() => {
                    clearSpringTimer();
                    onNavigate(segment.path);
                  }, 900);
                }
              }}
              onDragEnter={(e) => {
                e.preventDefault();
                e.stopPropagation();
                e.dataTransfer.dropEffect = 'copy';
                setDragOverSegment(segment.path);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                e.stopPropagation();
                clearSpringTimer();
                setDragOverSegment((cur) => (cur === segment.path ? null : cur));
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                clearSpringTimer();
                setDragOverSegment(null);
                onDropToPath?.(segment.path, e);
              }}
              className={classNames(
                'shrink-0 rounded px-1.5 py-0.5 transition-colors font-medium',
                isHovered
                  ? 'bg-sky-500/25 text-sky-400 ring-1 ring-inset ring-sky-400 font-semibold'
                  : 'text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary'
              )}
            >
              {segment.label}
            </button>
          </React.Fragment>
        );
      })}
    </div>
  );
};

export default Breadcrumbs;
