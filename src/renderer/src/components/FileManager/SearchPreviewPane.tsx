import React, { useEffect, useState } from 'react';
import { FileText, Loader2 } from 'lucide-react';
import type { SearchMatch } from '@shared/types/search';

interface SearchPreviewPaneProps {
  providerId: string;
  match: SearchMatch | null;
}

const CONTEXT_LINES = 6;

export const SearchPreviewPane: React.FC<SearchPreviewPaneProps> = ({ providerId, match }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [startLine, setStartLine] = useState(1);

  useEffect(() => {
    if (!match || match.lineNumber === undefined) {
      setLines([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    window.multissh
      .searchPreview(providerId, match.path, match.lineNumber, CONTEXT_LINES)
      .then((result) => {
        if (cancelled) return;
        // Drop a trailing empty line from the final newline, keep everything else.
        const rawLines = result.content.split('\n');
        if (rawLines[rawLines.length - 1] === '') rawLines.pop();
        setLines(rawLines);
        setStartLine(result.startLine);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Could not load a preview for this file');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [providerId, match]);

  if (!match) {
    return (
      <div className="flex flex-1 items-center justify-center text-xs text-txt-muted">
        Select a match to preview it here
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1.5 border-b border-border-subtle bg-app-surface px-3 py-2 text-xs text-txt-secondary">
        <FileText className="h-3.5 w-3.5 shrink-0 text-sky-400" />
        <span className="truncate font-mono">{match.displayPath}</span>
        {match.lineNumber !== undefined && (
          <span className="shrink-0 text-txt-muted">:{match.lineNumber}</span>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-app-surface-subtle font-mono text-xs">
        {loading && (
          <div className="flex items-center justify-center gap-2 py-6 text-txt-muted">
            <Loader2 className="h-4 w-4 animate-spin text-sky-400" />
            Loading preview...
          </div>
        )}
        {!loading && error && <div className="p-3 text-red-300">{error}</div>}
        {!loading && !error && lines.length === 0 && match.lineNumber === undefined && (
          <div className="p-3 text-txt-muted">No line-level preview available for this result.</div>
        )}
        {!loading && !error && lines.length > 0 && (
          <table className="w-full border-collapse">
            <tbody>
              {lines.map((line, idx) => {
                const lineNo = startLine + idx;
                const isMatchLine = lineNo === match.lineNumber;
                return (
                  <tr key={lineNo} className={isMatchLine ? 'bg-sky-500/15' : undefined}>
                    <td className="select-none whitespace-nowrap border-r border-border-subtle px-2 py-0.5 text-right text-txt-muted">
                      {lineNo}
                    </td>
                    <td className="whitespace-pre px-2 py-0.5 text-txt-primary">{line || ' '}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default SearchPreviewPane;
