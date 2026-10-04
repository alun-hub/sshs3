import { BrowserWindow } from 'electron';

export interface SplashController {
  /** Updates the progress bar (0-100, never moves backwards) and the status line. */
  setProgress(percent: number, status: string): void;
  close(): void;
}

const SPLASH_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<style>
  html, body { margin: 0; height: 100%; overflow: hidden; user-select: none; }
  body {
    box-sizing: border-box; display: flex; flex-direction: column; justify-content: center;
    padding: 0 36px; background: #0f172a; color: #e2e8f0; border: 1px solid #334155;
    font-family: 'Segoe UI', system-ui, sans-serif; -webkit-app-region: drag;
  }
  #brand { display: flex; align-items: center; gap: 14px; margin-bottom: 8px; }
  #brand svg { width: 56px; height: 41px; }
  h1 { margin: 0; font-size: 28px; font-weight: 600; letter-spacing: .5px; }
  h1 span { color: #eab308; }
  #status { margin: 0 0 18px; font-size: 13px; color: #94a3b8; min-height: 18px; }
  #track { height: 6px; border-radius: 3px; background: #1e293b; overflow: hidden; }
  #bar { height: 100%; width: 0; border-radius: 3px; background: #eab308; transition: width .35s ease-out; }
  #pct { margin-top: 8px; font-size: 11px; color: #64748b; text-align: right; }
</style>
</head>
<body>
  <div id="brand">
    <svg viewBox="60 110 392 284" fill="none" aria-hidden="true">
      <path d="M 191 254 L 234 297 L 156 373 A 72 72 0 1 1 160.3 229.1 A 96 96 0 0 1 351.7 229.1 A 72 72 0 1 1 356 373" stroke="#eab308" stroke-width="28" stroke-linecap="round" stroke-linejoin="round"/>
      <polygon points="216,359 360,359 360,387 188,387" fill="#eab308"/>
      <rect x="268" y="325" width="62" height="22" fill="#eab308"/>
    </svg>
    <h1>ssh<span>S3</span></h1>
  </div>
  <p id="status">Starting…</p>
  <div id="track"><div id="bar"></div></div>
  <div id="pct">0%</div>
<script>
  function setProgress(p, s) {
    document.getElementById('bar').style.width = p + '%';
    document.getElementById('pct').textContent = Math.round(p) + '%';
    document.getElementById('status').textContent = s;
  }
</script>
</body>
</html>`;

/** Fast starts never see the splash: it only appears if startup is still running after this long. */
const SHOW_AFTER_MS = 700;

/**
 * Shows a small frameless startup window with a progress bar if startup takes
 * longer than SHOW_AFTER_MS. Windows-only: returns `null` on every other
 * platform so their startup path is left untouched.
 */
export function showSplash(): SplashController | null {
  if (process.platform !== 'win32') return null;

  let win: BrowserWindow | null = null;
  let closed = false;
  let current = 0;
  let status = '';
  let loaded = false;

  const render = (): void => {
    if (!loaded || !win || win.isDestroyed()) return;
    // Both arguments are JSON-encoded, so the status text can never break out of the call.
    void win.webContents
      .executeJavaScript(`setProgress(${JSON.stringify(current)}, ${JSON.stringify(status)})`)
      .catch(() => {});
  };

  const timer = setTimeout(() => {
    if (closed) return;
    win = new BrowserWindow({
      width: 440,
      height: 220,
      frame: false,
      resizable: false,
      movable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      center: true,
      backgroundColor: '#0f172a',
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    win.setMenu(null);
    win.on('closed', () => {
      win = null;
    });
    win.webContents.once('did-finish-load', () => {
      loaded = true;
      render();
    });
    void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(SPLASH_HTML)}`);
  }, SHOW_AFTER_MS);

  return {
    setProgress(percent, text) {
      current = Math.max(current, Math.min(100, percent));
      status = text;
      render();
    },
    close() {
      closed = true;
      clearTimeout(timer);
      if (win && !win.isDestroyed()) win.destroy();
      win = null;
    },
  };
}
