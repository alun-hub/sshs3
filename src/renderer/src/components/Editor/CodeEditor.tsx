import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState, Compartment } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { defaultKeymap, historyKeymap, indentWithTab } from '@codemirror/commands';
import { oneDark } from '@codemirror/theme-one-dark';
import { search, setSearchQuery, SearchQuery, SearchCursor, findNext, findPrevious } from '@codemirror/search';
import { getLanguageExtension } from './editorLanguages';

export interface CodeEditorHandle {
  findNext: () => boolean;
  findPrevious: () => boolean;
  scrollToBottom: () => void;
  focus: () => void;
  getView: () => EditorView | null;
}

export interface CodeEditorProps {
  value: string;
  fileName: string;
  readOnly?: boolean;
  wordWrap?: boolean;
  searchQuery?: string;
  ariaLabel?: string;
  onChange?: (value: string) => void;
  onSave?: () => void;
  onSearchRequested?: () => void;
  onCursorChange?: (pos: { line: number; col: number }) => void;
  onMatchesCountChange?: (count: number) => void;
  onScrollNearBottomChange?: (isNearBottom: boolean) => void;
  autoFocus?: boolean;
  className?: string;
}

const customAppTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '12px',
    fontFamily: '"JetBrains Mono", "Fira Code", monospace',
    backgroundColor: 'transparent',
  },
  '.cm-content': {
    padding: '8px 4px',
    caretColor: '#38bdf8',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--color-app-surface, #0f172a)',
    color: '#64748b',
    borderRight: '1px solid var(--color-divider, #1e293b)',
    minWidth: '40px',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'rgba(56, 189, 248, 0.08)',
    color: '#38bdf8',
  },
  '.cm-activeLine': {
    backgroundColor: 'rgba(56, 189, 248, 0.04)',
  },
  '.cm-selectionBackground, ::selection': {
    backgroundColor: 'rgba(56, 189, 248, 0.25) !important',
  },
  '.cm-searchMatch': {
    backgroundColor: 'rgba(56, 189, 248, 0.3)',
    borderRadius: '2px',
  },
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: 'rgba(234, 179, 8, 0.45)',
    outline: '1px solid #eab308',
  },
  '&.cm-focused': {
    outline: 'none',
  },
});

export const CodeEditor = forwardRef<CodeEditorHandle, CodeEditorProps>(({
  value,
  fileName,
  readOnly = false,
  wordWrap = false,
  searchQuery = '',
  ariaLabel,
  onChange,
  onSave,
  onSearchRequested,
  onCursorChange,
  onMatchesCountChange,
  onScrollNearBottomChange,
  autoFocus = true,
  className = '',
}, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  const onSearchRequestedRef = useRef(onSearchRequested);
  onSearchRequestedRef.current = onSearchRequested;

  const onCursorChangeRef = useRef(onCursorChange);
  onCursorChangeRef.current = onCursorChange;

  const onMatchesCountChangeRef = useRef(onMatchesCountChange);
  onMatchesCountChangeRef.current = onMatchesCountChange;

  const langCompartmentRef = useRef(new Compartment());
  const readOnlyCompartmentRef = useRef(new Compartment());
  const wordWrapCompartmentRef = useRef(new Compartment());

  useImperativeHandle(ref, () => ({
    findNext: () => {
      const v = viewRef.current;
      return v ? findNext(v) : false;
    },
    findPrevious: () => {
      const v = viewRef.current;
      return v ? findPrevious(v) : false;
    },
    scrollToBottom: () => {
      const v = viewRef.current;
      if (v) {
        v.scrollDOM.scrollTop = v.scrollDOM.scrollHeight;
      }
    },
    focus: () => {
      viewRef.current?.focus();
    },
    getView: () => viewRef.current,
  }));

  // Initialize CodeMirror instance
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const langExt = getLanguageExtension(fileName);
    const editorKeymap = keymap.of([
      {
        key: 'Mod-s',
        run: () => {
          onSaveRef.current?.();
          return true;
        },
      },
      {
        key: 'Mod-f',
        run: () => {
          onSearchRequestedRef.current?.();
          return true;
        },
      },
    ]);

    const state = EditorState.create({
      doc: value,
      extensions: [
        basicSetup,
        search({ top: false }),
        oneDark,
        customAppTheme,
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        editorKeymap,
        EditorView.contentAttributes.of({
          'aria-label': ariaLabel || `Editor for ${fileName}`,
        }),
        langCompartmentRef.current.of(langExt ? [langExt] : []),
        readOnlyCompartmentRef.current.of(EditorState.readOnly.of(readOnly)),
        wordWrapCompartmentRef.current.of(wordWrap ? [EditorView.lineWrapping] : []),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            const nextVal = update.state.doc.toString();
            onChangeRef.current?.(nextVal);
          }
          if (update.selectionSet || update.docChanged) {
            const pos = update.state.selection.main.head;
            const line = update.state.doc.lineAt(pos);
            onCursorChangeRef.current?.({
              line: line.number,
              col: pos - line.from + 1,
            });
          }
        }),
      ],
    });

    const view = new EditorView({
      state,
      parent: container,
    });
    viewRef.current = view;
    if (autoFocus && !readOnly) {
      view.focus();
    }

    (container as any).__cmView = view;
    (container as any).__cmChangeDoc = (newDoc: string) => {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: newDoc },
      });
    };

    const scrollDOM = view.scrollDOM;
    const handleScroll = () => {
      if (onScrollNearBottomChange) {
        const isNearBottom = scrollDOM.scrollHeight - scrollDOM.scrollTop - scrollDOM.clientHeight < 40;
        onScrollNearBottomChange(isNearBottom);
      }
    };
    scrollDOM.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      delete (container as any).__cmView;
      delete (container as any).__cmChangeDoc;
      scrollDOM.removeEventListener('scroll', handleScroll);
      view.destroy();
      viewRef.current = null;
    };
    // Only re-create if container unmounts
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync external value changes (e.g. reload or tail streaming)
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const currentVal = view.state.doc.toString();
    if (value !== currentVal) {
      view.dispatch({
        changes: { from: 0, to: currentVal.length, insert: value },
      });
    }
  }, [value]);

  // Update language dynamically on fileName change
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const langExt = getLanguageExtension(fileName);
    view.dispatch({
      effects: langCompartmentRef.current.reconfigure(langExt ? [langExt] : []),
    });
  }, [fileName]);

  // Update readOnly dynamically
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: readOnlyCompartmentRef.current.reconfigure(EditorState.readOnly.of(readOnly)),
    });
  }, [readOnly]);

  // Update wordWrap dynamically
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: wordWrapCompartmentRef.current.reconfigure(wordWrap ? [EditorView.lineWrapping] : []),
    });
  }, [wordWrap]);

  // Update search query highlights and match counts dynamically
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const q = searchQuery.trim();
    view.dispatch({
      effects: setSearchQuery.of(new SearchQuery({ search: q, caseSensitive: false })),
    });

    if (q) {
      let count = 0;
      const cursor = new SearchCursor(view.state.doc, q);
      while (!cursor.next().done) {
        count++;
      }
      onMatchesCountChangeRef.current?.(count);
    } else {
      onMatchesCountChangeRef.current?.(0);
    }
  }, [searchQuery, value]);

  return (
    <div
      ref={containerRef}
      data-testid="code-editor"
      className={`relative h-full w-full overflow-hidden ${className}`}
    />
  );
});

CodeEditor.displayName = 'CodeEditor';
