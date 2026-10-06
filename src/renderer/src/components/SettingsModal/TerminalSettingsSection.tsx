import React from 'react';
import { X, Terminal, RotateCcw } from 'lucide-react';
import { FONT_PRESETS } from './settingsConstants';
import { X11ServerSection } from './X11ServerSection';
import type { SettingsForm } from './useSettingsForm';

/** The "Terminal" page of the settings dialog. */
export const TerminalSettingsSection: React.FC<{ form: SettingsForm }> = ({ form }) => {
  const {
    theme,
    fontSize,
    setFontSize,
    fontFamily,
    setFontFamily,
    cursorStyle,
    setCursorStyle,
    scrollback,
    setScrollback,
    copyOnSelect,
    setCopyOnSelect,
    clipboardScope,
    setClipboardScope,
    clipboardClearOnExit,
    setClipboardClearOnExit,
    sessionExitAction,
    setSessionExitAction,
    autoSyncLocalSshConfig,
    setAutoSyncLocalSshConfig,
    localTerminalAgentMode,
    setLocalTerminalAgentMode,
  } = form;

  return (
    <div className="space-y-4">
      {/* Font Size */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-txt-primary">Terminal Font Size</label>
          <span className="font-mono text-sky-400 font-semibold">{fontSize} px</span>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={8}
            max={32}
            step={1}
            value={fontSize}
            onChange={(e) => setFontSize(parseInt(e.target.value, 10))}
            className="flex-1 accent-sky-500 cursor-pointer"
          />
          <input
            type="number"
            min={8}
            max={32}
            value={fontSize}
            onChange={(e) => {
              const val = parseInt(e.target.value, 10);
              if (!Number.isNaN(val) && val >= 8 && val <= 32) {
                setFontSize(val);
              }
            }}
            className="w-16 rounded-lg border border-border-subtle bg-app-input px-2 py-1 text-center font-mono text-xs text-txt-primary outline-none focus:border-sky-500"
          />
        </div>
      </div>

      {/* Font Family */}
      <div className="space-y-2">
        <label className="text-xs font-medium text-txt-primary">Terminal Font Family</label>
        <select
          value={FONT_PRESETS.some((f) => f.value === fontFamily) ? fontFamily : 'custom'}
          onChange={(e) => {
            if (e.target.value !== 'custom') {
              setFontFamily(e.target.value);
            }
          }}
          className="w-full rounded-lg border border-border-subtle bg-app-surface px-3 py-2 text-xs text-txt-primary outline-none focus:border-sky-500"
        >
          {FONT_PRESETS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
          <option value="custom">Custom...</option>
        </select>
        <input
          aria-label="Custom font family"
          type="text"
          value={fontFamily}
          onChange={(e) => setFontFamily(e.target.value)}
          placeholder="Enter custom font family..."
          className="w-full rounded-lg border border-border-subtle bg-app-input px-3 py-2 font-mono text-xs text-txt-primary outline-none focus:border-sky-500"
        />
      </div>

      {/* Terminal Live Preview */}
      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-txt-muted uppercase tracking-wider">
          Terminal Live Preview
        </label>
        <div
          className={`rounded-lg border p-3 font-mono transition-colors shadow-inner ${
            theme === 'breeze'
              ? 'border-border-subtle bg-[#232627] text-[#fcfcfc]'
              : theme === 'light'
                ? 'border-border-subtle bg-white text-slate-900'
                : 'border-border-subtle bg-black/40 text-slate-100'
          }`}
          style={{
            fontFamily: fontFamily || 'monospace',
            fontSize: `${fontSize}px`,
            lineHeight: '1.45',
          }}
        >
          <div className={theme === 'breeze' ? 'text-[#11d116]' : 'text-emerald-400'}>$ uname -srm</div>
          <div>Linux 6.1.0-custom x86_64</div>
          <div className={theme === 'breeze' ? 'text-[#3daee9]' : 'text-sky-400'}>sshs3 session active. Ready.</div>
        </div>
      </div>

      {/* Cursor Style & Scrollback */}
      <div className="grid grid-cols-2 gap-3 pt-2 border-t border-divider">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-txt-primary">Cursor Style</label>
          <select
            value={cursorStyle}
            onChange={(e) => setCursorStyle(e.target.value as any)}
            className="w-full rounded-lg border border-border-subtle bg-app-surface px-3 py-2 text-xs text-txt-primary outline-none focus:border-sky-500"
          >
            <option value="block">Block</option>
            <option value="underline">Underline</option>
            <option value="bar">Vertical Bar</option>
          </select>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-txt-primary">Scrollback Buffer (lines)</label>
          <input
            type="number"
            min={500}
            max={50000}
            step={500}
            value={scrollback}
            onChange={(e) => setScrollback(Number(e.target.value) || 5000)}
            className="w-full rounded-lg border border-border-subtle bg-app-input px-3 py-2 text-xs text-txt-primary outline-none focus:border-sky-500"
          />
        </div>
      </div>

      {/* Copy on select */}
      <label className="flex items-center gap-2.5 pt-1 cursor-pointer">
        <input
          type="checkbox"
          checked={copyOnSelect}
          onChange={(e) => setCopyOnSelect(e.target.checked)}
          className="h-4 w-4 rounded border-border-subtle text-sky-600 focus:ring-sky-500"
        />
        <span className="text-xs text-txt-primary">Copy text automatically on selection</span>
      </label>
      <p className="text-xs text-txt-muted -mt-1 pl-6">
        Selections are kept in an encrypted history. Shift+Insert and middle-click paste the latest one;
        right-click opens the full history.
      </p>

      <div className="space-y-1.5 pl-6">
        <label className="text-xs font-medium text-txt-primary" htmlFor="clipboard-history-scope">
          Clipboard history scope
        </label>
        <div className="flex items-center gap-2">
          <select
            id="clipboard-history-scope"
            value={clipboardScope}
            onChange={(e) => setClipboardScope(e.target.value === 'host' ? 'host' : 'global')}
            className="rounded-lg border border-border-subtle bg-app-input px-3 py-2 text-xs text-txt-primary outline-none focus:border-sky-500"
          >
            <option value="global">Global (shared by all hosts and terminals)</option>
            <option value="host">Per host (follows the connection)</option>
          </select>
          <button
            type="button"
            onClick={() => void window.multissh.clipboardHistoryClear()}
            className="rounded-lg border border-border-subtle px-3 py-2 text-xs text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary cursor-pointer"
          >
            Clear history
          </button>
        </div>
        <label className="flex items-center gap-2.5 pt-1 cursor-pointer">
          <input
            type="checkbox"
            checked={clipboardClearOnExit}
            onChange={(e) => setClipboardClearOnExit(e.target.checked)}
            className="h-4 w-4 rounded border-border-subtle text-sky-600 focus:ring-sky-500"
          />
          <span className="text-xs text-txt-primary">Empty clipboard history on exit</span>
        </label>
      </div>

      {/* Session Exit Action */}
      <div className="space-y-2 pt-2 border-t border-divider">
        <div>
          <label className="text-xs font-medium text-txt-primary">On Logout / Session End</label>
          <p className="text-xs text-txt-muted">Choose what happens when an SSH session or local terminal ends.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <label
            className={`flex flex-col gap-1.5 rounded-lg border p-2.5 text-xs cursor-pointer transition-colors ${
              sessionExitAction === 'reconnect'
                ? 'border-sky-500 bg-sky-500/15 text-sky-300'
                : 'border-border-subtle bg-app-surface text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary'
            }`}
          >
            <div className="flex items-center gap-2 font-medium">
              <input
                type="radio"
                name="sessionExitAction"
                checked={sessionExitAction === 'reconnect'}
                onChange={() => setSessionExitAction('reconnect')}
                className="hidden"
              />
              <RotateCcw className="h-3.5 w-3.5 text-sky-400" />
              <span>Reconnect (Default)</span>
            </div>
            <span className="text-xs text-txt-muted leading-tight">
              Shows quick buttons to reconnect directly or close the tab.
            </span>
          </label>

          <label
            className={`flex flex-col gap-1.5 rounded-lg border p-2.5 text-xs cursor-pointer transition-colors ${
              sessionExitAction === 'close'
                ? 'border-sky-500 bg-sky-500/15 text-sky-300'
                : 'border-border-subtle bg-app-surface text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary'
            }`}
          >
            <div className="flex items-center gap-2 font-medium">
              <input
                type="radio"
                name="sessionExitAction"
                checked={sessionExitAction === 'close'}
                onChange={() => setSessionExitAction('close')}
                className="hidden"
              />
              <X className="h-3.5 w-3.5 text-amber-400" />
              <span>Close Tab Immediately</span>
            </div>
            <span className="text-xs text-txt-muted leading-tight">
              Closes the tab automatically on a clean logout (code 0).
            </span>
          </label>

          <label
            className={`flex flex-col gap-1.5 rounded-lg border p-2.5 text-xs cursor-pointer transition-colors ${
              sessionExitAction === 'keep'
                ? 'border-sky-500 bg-sky-500/15 text-sky-300'
                : 'border-border-subtle bg-app-surface text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary'
            }`}
          >
            <div className="flex items-center gap-2 font-medium">
              <input
                type="radio"
                name="sessionExitAction"
                checked={sessionExitAction === 'keep'}
                onChange={() => setSessionExitAction('keep')}
                className="hidden"
              />
              <Terminal className="h-3.5 w-3.5 text-txt-muted" />
              <span>Keep Open</span>
            </div>
            <span className="text-xs text-txt-muted leading-tight">
              Leave the terminal open with no quick buttons (classic mode).
            </span>
          </label>
        </div>
      </div>

      {/* SSH CLI & Agent Integration */}
      <div className="space-y-3 pt-3 border-t border-divider">
        <div>
          <label className="text-xs font-medium text-txt-primary">Local Terminal SSH Agent</label>
          <p className="text-xs text-txt-muted">
            Configure how the <code>SSH_AUTH_SOCK</code> environment variable is set in local shell terminals.
          </p>
        </div>
        <select
          value={localTerminalAgentMode}
          onChange={(e) =>
            setLocalTerminalAgentMode(
              e.target.value as 'auto' | 'system' | 'app-managed' | 'disabled'
            )
          }
          className="w-full rounded-lg border border-border-subtle bg-app-surface px-3 py-2 text-xs text-txt-primary outline-none focus:border-sky-500"
        >
          <option value="auto">Auto (Active smartcard agent, else system/login shell agent, else sshs3-managed)</option>
          <option value="system">System Only (Inherit system or login shell SSH_AUTH_SOCK)</option>
          <option value="disabled">Disabled (Do not set SSH_AUTH_SOCK)</option>
        </select>
      </div>

      <div className="space-y-2 pt-3 border-t border-divider">
        <label className="flex items-start gap-2 text-xs text-txt-primary">
          <input
            type="checkbox"
            checked={autoSyncLocalSshConfig}
            onChange={(e) => setAutoSyncLocalSshConfig(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            Keep <code>~/.ssh/config</code> in sync with saved SSH profiles
            <span className="block text-txt-muted">
              Maintains a managed block so plain <code>ssh &lt;profile&gt;</code> works in any terminal.
              Only the sshs3 block is touched.
            </span>
          </span>
        </label>
      </div>

      <X11ServerSection form={form} />
    </div>
  );
};
