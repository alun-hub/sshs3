import React, { useState, useEffect } from 'react';
import { Settings, X, Terminal, Monitor, Moon, Sun } from 'lucide-react';
import type { AppSettings, AppTheme } from '@shared/types/settings';

interface SettingsModalProps {
  open: boolean;
  currentSettings: AppSettings;
  onSave: (settings: AppSettings) => void;
  onClose: () => void;
}

const FONT_PRESETS = [
  'Menlo, Monaco, "Courier New", monospace, Consolas',
  'Fira Code, monospace',
  'JetBrains Mono, monospace',
  'Consolas, "Courier New", monospace',
  'Ubuntu Mono, monospace',
  'monospace',
];

export const SettingsModal: React.FC<SettingsModalProps> = ({
  open,
  currentSettings,
  onSave,
  onClose,
}) => {
  const [theme, setTheme] = useState<AppTheme>(currentSettings.theme);
  const [fontSize, setFontSize] = useState<number>(currentSettings.terminalFontSize);
  const [fontFamily, setFontFamily] = useState<string>(currentSettings.terminalFontFamily);
  const [defaultNewTab, setDefaultNewTab] = useState<'terminal' | 'filemanager'>(
    currentSettings.defaultNewTabType
  );

  useEffect(() => {
    if (open) {
      setTheme(currentSettings.theme);
      setFontSize(currentSettings.terminalFontSize);
      setFontFamily(currentSettings.terminalFontFamily);
      setDefaultNewTab(currentSettings.defaultNewTabType);
    }
  }, [open, currentSettings]);

  if (!open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      theme,
      terminalFontSize: fontSize,
      terminalFontFamily: fontFamily,
      defaultNewTabType: defaultNewTab,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-lg border border-slate-700 bg-slate-900 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 bg-slate-800/80 px-4 py-3">
          <div className="flex items-center gap-2">
            <Settings className="h-5 w-5 text-sky-400" />
            <h2 className="text-sm font-semibold text-slate-100">Inställningar</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:bg-slate-700 hover:text-slate-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4 text-xs text-slate-300">
          {/* Theme */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-300">Tema</label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setTheme('dark')}
                className={`flex items-center justify-center gap-2 rounded border px-3 py-2 text-xs font-medium transition-colors ${
                  theme === 'dark'
                    ? 'border-sky-500 bg-sky-950/60 text-sky-200'
                    : 'border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                <Moon className="h-3.5 w-3.5" />
                Mörkt
              </button>
              <button
                type="button"
                onClick={() => setTheme('light')}
                className={`flex items-center justify-center gap-2 rounded border px-3 py-2 text-xs font-medium transition-colors ${
                  theme === 'light'
                    ? 'border-sky-500 bg-sky-950/60 text-sky-200'
                    : 'border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                <Sun className="h-3.5 w-3.5" />
                Ljust
              </button>
              <button
                type="button"
                onClick={() => setTheme('system')}
                className={`flex items-center justify-center gap-2 rounded border px-3 py-2 text-xs font-medium transition-colors ${
                  theme === 'system'
                    ? 'border-sky-500 bg-sky-950/60 text-sky-200'
                    : 'border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                <Monitor className="h-3.5 w-3.5" />
                System
              </button>
            </div>
          </div>

          {/* Terminal Font Size */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-slate-300">Terminal typsnittsstorlek</label>
              <span className="font-mono text-sky-400 font-semibold">{fontSize} px</span>
            </div>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={10}
                max={24}
                step={1}
                value={fontSize}
                onChange={(e) => setFontSize(parseInt(e.target.value, 10))}
                className="flex-1 accent-sky-500"
              />
              <input
                type="number"
                min={10}
                max={24}
                value={fontSize}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  if (!Number.isNaN(val) && val >= 10 && val <= 24) {
                    setFontSize(val);
                  }
                }}
                className="w-16 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-center font-mono text-xs text-slate-100 outline-none focus:border-sky-500"
              />
            </div>
          </div>

          {/* Terminal Font Family */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-300">Terminal typsnitt</label>
            <select
              value={FONT_PRESETS.includes(fontFamily) ? fontFamily : 'custom'}
              onChange={(e) => {
                if (e.target.value !== 'custom') {
                  setFontFamily(e.target.value);
                }
              }}
              className="w-full rounded border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs text-slate-200 outline-none focus:border-sky-500"
            >
              {FONT_PRESETS.map((f) => (
                <option key={f} value={f}>
                  {f.split(',')[0].replace(/"/g, '')}
                </option>
              ))}
              <option value="custom">Anpassat...</option>
            </select>
            <input
              type="text"
              value={fontFamily}
              onChange={(e) => setFontFamily(e.target.value)}
              placeholder="Skriv in typsnittsfamilj..."
              className="w-full rounded border border-slate-700 bg-slate-950 px-2.5 py-1.5 font-mono text-xs text-slate-100 outline-none focus:border-sky-500"
            />
          </div>

          {/* Default Tab Behavior */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-300">Standardflik för nya flikar</label>
            <div className="grid grid-cols-2 gap-2">
              <label
                className={`flex items-center gap-2 rounded border px-3 py-2 text-xs font-medium cursor-pointer transition-colors ${
                  defaultNewTab === 'terminal'
                    ? 'border-sky-500 bg-sky-950/60 text-sky-200'
                    : 'border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                <input
                  type="radio"
                  name="defaultTab"
                  checked={defaultNewTab === 'terminal'}
                  onChange={() => setDefaultNewTab('terminal')}
                  className="hidden"
                />
                <Terminal className="h-3.5 w-3.5 text-sky-400" />
                <span>Terminal</span>
              </label>

              <label
                className={`flex items-center gap-2 rounded border px-3 py-2 text-xs font-medium cursor-pointer transition-colors ${
                  defaultNewTab === 'filemanager'
                    ? 'border-amber-500 bg-amber-950/60 text-amber-200'
                    : 'border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                <input
                  type="radio"
                  name="defaultTab"
                  checked={defaultNewTab === 'filemanager'}
                  onChange={() => setDefaultNewTab('filemanager')}
                  className="hidden"
                />
                <span className="h-3.5 w-3.5 font-bold text-amber-400">📁</span>
                <span>Filhanterare</span>
              </label>
            </div>
          </div>

          {/* Live Preview */}
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">Förhandsvisning av terminal</label>
            <div
              className={`rounded border p-3 font-mono transition-colors ${
                theme === 'light'
                  ? 'border-slate-300 bg-slate-50 text-slate-900'
                  : 'border-slate-800 bg-slate-950 text-slate-100'
              }`}
              style={{
                fontFamily: fontFamily || 'monospace',
                fontSize: `${fontSize}px`,
                lineHeight: '1.4',
              }}
            >
              <div className="text-emerald-400">$ uname -srm</div>
              <div>Linux 6.1.0-custom x86_64</div>
              <div className="text-sky-400">MultiSSH ready.</div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 border-t border-slate-800 pt-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700"
            >
              Avbryt
            </button>
            <button
              type="submit"
              className="rounded bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500"
            >
              Spara inställningar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
export default SettingsModal;
