import React, { useState, useMemo, useRef, useEffect } from 'react';
import { ExternalLink, RotateCw, Monitor, Tablet, Smartphone, ChevronLeft, ChevronRight } from 'lucide-react';
import { classNames } from '../../lib/format';

export interface HtmlPreviewProps {
  htmlContent: string;
  fileName: string;
  onOpenInBrowser?: () => void;
}

type ViewportMode = 'desktop' | 'tablet' | 'mobile';

const VIEWPORT_WIDTHS: Record<ViewportMode, string> = {
  desktop: '100%',
  tablet: '768px',
  mobile: '375px',
};

const INTERCEPT_SCRIPT = `
<script>
(function() {
  document.addEventListener('click', function(e) {
    var a = e.target.closest('a');
    if (!a) return;
    var href = a.getAttribute('href');
    if (!href) return;
    if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('mailto:')) {
      e.preventDefault();
      window.parent.postMessage({ type: 'html-preview-open-url', url: href }, '*');
    }
  }, true);
})();
</script>
`;

export const HtmlPreview: React.FC<HtmlPreviewProps> = ({
  htmlContent,
  fileName,
  onOpenInBrowser,
}) => {
  const [viewport, setViewport] = useState<ViewportMode>('desktop');
  const [refreshKey, setRefreshKey] = useState<number>(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      if (e.data?.type === 'html-preview-open-url' && typeof e.data.url === 'string') {
        window.multissh?.openExternal?.(e.data.url);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleBack = () => {
    try {
      iframeRef.current?.contentWindow?.history.back();
    } catch {
      // Safe to ignore
    }
  };

  const handleForward = () => {
    try {
      iframeRef.current?.contentWindow?.history.forward();
    } catch {
      // Safe to ignore
    }
  };

  const safeDoc = useMemo(() => {
    const raw =
      htmlContent ||
      '<!DOCTYPE html><html><body><p style="color:#888;font-family:sans-serif;padding:20px;">Empty HTML document</p></body></html>';
    if (raw.includes('</body>')) {
      return raw.replace('</body>', `${INTERCEPT_SCRIPT}</body>`);
    }
    return `${raw}${INTERCEPT_SCRIPT}`;
  }, [htmlContent]);

  return (
    <div
      data-testid="html-preview"
      className="relative flex flex-col h-full w-full overflow-hidden select-none bg-app-card"
    >
      {/* Top Floating Controls */}
      <div className="flex items-center justify-between border-b border-divider bg-app-surface px-4 py-2 text-xs text-txt-secondary select-none">
        <div className="flex items-center gap-1.5">
          <span className="font-semibold text-txt-primary">{fileName}</span>
          <span className="rounded bg-sky-500/20 text-sky-400 px-1.5 py-0.5 text-2xs font-mono font-medium">
            Sandboxed Preview
          </span>
        </div>

        <div className="flex items-center gap-1">
          {/* History Navigation Buttons */}
          <div className="flex items-center gap-0.5 mr-1 border-r border-divider pr-1.5">
            <button
              type="button"
              title="Back"
              onClick={handleBack}
              className="rounded p-1 hover:bg-app-surface-hover hover:text-txt-primary transition-colors text-txt-secondary"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              title="Forward"
              onClick={handleForward}
              className="rounded p-1 hover:bg-app-surface-hover hover:text-txt-primary transition-colors text-txt-secondary"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Responsive Viewport Switcher */}
          <div
            role="group"
            aria-label="Responsive viewport mode"
            className="flex items-center rounded-lg border border-border-subtle bg-app-input p-0.5"
          >
            <button
              type="button"
              title="Desktop View (100%)"
              onClick={() => setViewport('desktop')}
              className={classNames(
                'rounded p-1 transition-colors',
                viewport === 'desktop'
                  ? 'bg-sky-500/20 text-sky-400'
                  : 'hover:bg-app-surface-hover hover:text-txt-primary'
              )}
            >
              <Monitor className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              title="Tablet View (768px)"
              onClick={() => setViewport('tablet')}
              className={classNames(
                'rounded p-1 transition-colors',
                viewport === 'tablet'
                  ? 'bg-sky-500/20 text-sky-400'
                  : 'hover:bg-app-surface-hover hover:text-txt-primary'
              )}
            >
              <Tablet className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              title="Mobile View (375px)"
              onClick={() => setViewport('mobile')}
              className={classNames(
                'rounded p-1 transition-colors',
                viewport === 'mobile'
                  ? 'bg-sky-500/20 text-sky-400'
                  : 'hover:bg-app-surface-hover hover:text-txt-primary'
              )}
            >
              <Smartphone className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Refresh iframe */}
          <button
            type="button"
            title="Reload Preview"
            onClick={() => setRefreshKey((k) => k + 1)}
            className="rounded-lg p-1.5 text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary transition-colors ml-1"
          >
            <RotateCw className="h-4 w-4" />
          </button>

          {/* Open in Browser */}
          {onOpenInBrowser && (
            <button
              type="button"
              title="Open in System Browser"
              onClick={onOpenInBrowser}
              className="flex items-center gap-1.5 rounded-lg border border-divider bg-app-surface px-2.5 py-1 text-xs font-semibold text-txt-secondary hover:border-sky-500/40 hover:text-sky-300 hover:bg-app-surface-hover transition-colors ml-2"
            >
              <ExternalLink className="h-3.5 w-3.5 text-sky-400" />
              <span>Browser</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Viewport Container */}
      <div className="flex-1 w-full h-full overflow-auto bg-slate-950/60 p-4 flex justify-center items-stretch">
        <div
          style={{ width: VIEWPORT_WIDTHS[viewport] }}
          className="h-full transition-all duration-200 shadow-2xl rounded-lg overflow-hidden border border-border-subtle bg-white"
        >
          <iframe
            ref={iframeRef}
            key={refreshKey}
            title={`Preview for ${fileName}`}
            srcDoc={safeDoc}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
            className="w-full h-full border-none block"
          />
        </div>
      </div>
    </div>
  );
};

export default HtmlPreview;
