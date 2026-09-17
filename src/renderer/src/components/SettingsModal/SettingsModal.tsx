import React, { useState, useEffect } from 'react';
import {
  Settings,
  X,
  Terminal,
  Monitor,
  Moon,
  Sun,
  Keyboard,
  Sliders,
  RotateCcw,
  Shield,
  FolderTree,
  Search,
  CheckCircle2,
  Lock,
  FileCode,
} from 'lucide-react';
import {
  SHORTCUT_DEFINITIONS,
  DEFAULT_SHORTCUTS,
  type AppSettings,
  type AppTheme,
  type SessionExitAction,
} from '@shared/types/settings';
import type { DetectedSmartcardLib } from '@shared/types/ssh';
import { DotfilePoolManagerModal } from './DotfilePoolManagerModal';

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

type SettingsCategory = 'general' | 'terminal' | 'files' | 'security' | 'shortcuts';

export const SettingsModal: React.FC<SettingsModalProps> = ({
  open,
  currentSettings,
  onSave,
  onClose,
}) => {
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>('general');
  const [theme, setTheme] = useState<AppTheme>(currentSettings.theme);
  const [fontSize, setFontSize] = useState<number>(currentSettings.terminalFontSize);
  const [fontFamily, setFontFamily] = useState<string>(currentSettings.terminalFontFamily);
  const [cursorStyle, setCursorStyle] = useState<'block' | 'underline' | 'bar'>(
    currentSettings.terminalCursorStyle ?? 'block'
  );
  const [scrollback, setScrollback] = useState<number>(
    currentSettings.terminalScrollback ?? 5000
  );
  const [copyOnSelect, setCopyOnSelect] = useState<boolean>(
    currentSettings.copyOnSelect ?? false
  );
  const [sessionExitAction, setSessionExitAction] = useState<SessionExitAction>(
    currentSettings.sessionExitAction ?? 'reconnect'
  );
  const [defaultNewTab, setDefaultNewTab] = useState<'terminal' | 'filemanager'>(
    currentSettings.defaultNewTabType
  );
  const [defaultConflictPolicy, setDefaultConflictPolicy] = useState<
    'ask' | 'overwrite' | 'skip' | 'rename'
  >(currentSettings.defaultConflictPolicy ?? 'ask');
  const [showHiddenFiles, setShowHiddenFiles] = useState<boolean>(
    currentSettings.showHiddenFiles ?? false
  );
  const [confirmBeforeDelete, setConfirmBeforeDelete] = useState<boolean>(
    currentSettings.confirmBeforeDelete ?? true
  );
  const [dotfilesPoolEnabled, setDotfilesPoolEnabled] = useState<boolean>(
    currentSettings.dotfilesPoolEnabled ?? false
  );
  const [poolManagerOpen, setPoolManagerOpen] = useState(false);

  const [shortcuts, setShortcuts] = useState<Record<string, string>>(
    currentSettings.shortcuts ?? DEFAULT_SHORTCUTS
  );
  const [recordingAction, setRecordingAction] = useState<string | null>(null);
  const [shortcutSearch, setShortcutSearch] = useState('');

  const [smartcardLibs, setSmartcardLibs] = useState<DetectedSmartcardLib[]>([]);
  const [detectingSmartcard, setDetectingSmartcard] = useState(false);

  useEffect(() => {
    if (open) {
      setActiveCategory('general');
      setTheme(currentSettings.theme);
      setFontSize(currentSettings.terminalFontSize);
      setFontFamily(currentSettings.terminalFontFamily);
      setCursorStyle(currentSettings.terminalCursorStyle ?? 'block');
      setScrollback(currentSettings.terminalScrollback ?? 5000);
      setCopyOnSelect(currentSettings.copyOnSelect ?? false);
      setSessionExitAction(currentSettings.sessionExitAction ?? 'reconnect');
      setDefaultNewTab(currentSettings.defaultNewTabType);
      setDefaultConflictPolicy(currentSettings.defaultConflictPolicy ?? 'ask');
      setShowHiddenFiles(currentSettings.showHiddenFiles ?? false);
      setConfirmBeforeDelete(currentSettings.confirmBeforeDelete ?? true);
      setDotfilesPoolEnabled(currentSettings.dotfilesPoolEnabled ?? false);
      setShortcuts(currentSettings.shortcuts ?? DEFAULT_SHORTCUTS);
      setRecordingAction(null);
      setShortcutSearch('');

      // Auto detect smartcards for security tab
      setDetectingSmartcard(true);
      void window.multissh
        ?.smartcardDetect?.()
        ?.then((libs) => {
          if (libs) setSmartcardLibs(libs.filter((l) => l.exists));
        })
        ?.finally(() => setDetectingSmartcard(false));
    }
  }, [open, currentSettings]);

  if (!open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      theme,
      terminalFontSize: fontSize,
      terminalFontFamily: fontFamily,
      terminalCursorStyle: cursorStyle,
      terminalScrollback: scrollback,
      copyOnSelect,
      sessionExitAction,
      defaultNewTabType: defaultNewTab,
      defaultConflictPolicy,
      showHiddenFiles,
      confirmBeforeDelete,
      dotfilesPoolEnabled,
      shortcuts,
    });
    onClose();
  };

  const handleResetShortcuts = () => {
    setShortcuts({ ...DEFAULT_SHORTCUTS });
  };

  const handleKeyDownRecord = (e: React.KeyboardEvent, actionId: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') {
      setRecordingAction(null);
      return;
    }
    const parts: string[] = [];
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.metaKey) parts.push('Cmd');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');

    let key = e.key;
    if (key === 'Control' || key === 'Meta' || key === 'Alt' || key === 'Shift') {
      return;
    }
    if (key === ' ') key = 'Space';
    else if (key.length === 1) key = key.toUpperCase();
    parts.push(key);

    const combo = parts.join('+');
    setShortcuts((prev) => ({ ...prev, [actionId]: combo }));
    setRecordingAction(null);
  };

  const categories: { id: SettingsCategory; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'general', label: 'General & Appearance', icon: Sliders },
    { id: 'terminal', label: 'Terminal', icon: Terminal },
    { id: 'files', label: 'Files & Storage', icon: FolderTree },
    { id: 'security', label: 'Security & Smartcard', icon: Shield },
    { id: 'shortcuts', label: 'Keyboard Shortcuts', icon: Keyboard },
  ];

  const filteredShortcuts = SHORTCUT_DEFINITIONS.filter(
    (s) =>
      !shortcutSearch ||
      s.name.toLowerCase().includes(shortcutSearch.toLowerCase()) ||
      s.category.toLowerCase().includes(shortcutSearch.toLowerCase()) ||
      s.defaultKeys.toLowerCase().includes(shortcutSearch.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div className="flex h-[560px] w-full max-w-3xl flex-col rounded-xl border border-border-subtle bg-app-card shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-border-subtle bg-app-surface px-5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-sky-500/10 text-sky-400">
              <Settings className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-txt-primary">Settings</h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-txt-muted hover:bg-app-surface-hover hover:text-txt-primary transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body with Sidebar & Content */}
        <div className="flex flex-1 min-h-0">
          {/* Sidebar */}
          <aside className="w-52 shrink-0 border-r border-border-subtle bg-app-surface p-2.5 flex flex-col gap-1">
            {categories.map((cat) => {
              const Icon = cat.icon;
              const isActive = activeCategory === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setActiveCategory(cat.id)}
                  className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium text-left transition-colors ${
                    isActive
                      ? 'bg-sky-500/15 text-sky-400 font-semibold'
                      : 'text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary'
                  }`}
                >
                  <Icon className={`h-4 w-4 ${isActive ? 'text-sky-400' : 'text-txt-muted'}`} />
                  <span>{cat.label}</span>
                </button>
              );
            })}
          </aside>

          {/* Form Content Area */}
          <form onSubmit={handleSubmit} className="flex flex-1 flex-col min-w-0 bg-app-card">
            <div className="flex-1 overflow-y-auto p-5 text-xs text-txt-secondary space-y-5">
              {/* Category: General & Appearance */}
              {activeCategory === 'general' && (
                <div className="space-y-4">
                  {/* Theme */}
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-txt-primary">Color Theme</label>
                    <div className="grid grid-cols-3 gap-2.5">
                      <button
                        type="button"
                        onClick={() => setTheme('dark')}
                        className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-xs font-medium transition-colors ${
                          theme === 'dark'
                            ? 'border-sky-500 bg-sky-500/15 text-sky-300'
                            : 'border-border-subtle bg-app-surface text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary'
                        }`}
                      >
                        <Moon className="h-4 w-4 text-sky-400" />
                        Dark
                      </button>
                      <button
                        type="button"
                        onClick={() => setTheme('light')}
                        className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-xs font-medium transition-colors ${
                          theme === 'light'
                            ? 'border-sky-500 bg-sky-500/15 text-sky-300'
                            : 'border-border-subtle bg-app-surface text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary'
                        }`}
                      >
                        <Sun className="h-4 w-4 text-amber-400" />
                        Light
                      </button>
                      <button
                        type="button"
                        onClick={() => setTheme('system')}
                        className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-xs font-medium transition-colors ${
                          theme === 'system'
                            ? 'border-sky-500 bg-sky-500/15 text-sky-300'
                            : 'border-border-subtle bg-app-surface text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary'
                        }`}
                      >
                        <Monitor className="h-4 w-4 text-sky-400" />
                        System
                      </button>
                    </div>
                  </div>

                  {/* Default New Tab Type */}
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-txt-primary">Default Tab Type</label>
                    <div className="grid grid-cols-2 gap-2.5">
                      <label
                        className={`flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-xs font-medium cursor-pointer transition-colors ${
                          defaultNewTab === 'terminal'
                            ? 'border-sky-500 bg-sky-500/15 text-sky-300'
                            : 'border-border-subtle bg-app-surface text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary'
                        }`}
                      >
                        <input
                          type="radio"
                          name="defaultTab"
                          checked={defaultNewTab === 'terminal'}
                          onChange={() => setDefaultNewTab('terminal')}
                          className="hidden"
                        />
                        <Terminal className="h-4 w-4 text-sky-400" />
                        <span>Terminal</span>
                      </label>

                      <label
                        className={`flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-xs font-medium cursor-pointer transition-colors ${
                          defaultNewTab === 'filemanager'
                            ? 'border-amber-500 bg-amber-500/15 text-amber-300'
                            : 'border-border-subtle bg-app-surface text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary'
                        }`}
                      >
                        <input
                          type="radio"
                          name="defaultTab"
                          checked={defaultNewTab === 'filemanager'}
                          onChange={() => setDefaultNewTab('filemanager')}
                          className="hidden"
                        />
                        <FolderTree className="h-4 w-4 text-amber-400" />
                        <span>File Manager</span>
                      </label>
                    </div>
                  </div>
                </div>
              )}

              {/* Category: Terminal */}
              {activeCategory === 'terminal' && (
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
                        min={10}
                        max={24}
                        step={1}
                        value={fontSize}
                        onChange={(e) => setFontSize(parseInt(e.target.value, 10))}
                        className="flex-1 accent-sky-500 cursor-pointer"
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
                        className="w-16 rounded-lg border border-border-subtle bg-app-input px-2 py-1 text-center font-mono text-xs text-txt-primary outline-none focus:border-sky-500"
                      />
                    </div>
                  </div>

                  {/* Font Family */}
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-txt-primary">Terminal Font Family</label>
                    <select
                      value={FONT_PRESETS.includes(fontFamily) ? fontFamily : 'custom'}
                      onChange={(e) => {
                        if (e.target.value !== 'custom') {
                          setFontFamily(e.target.value);
                        }
                      }}
                      className="w-full rounded-lg border border-border-subtle bg-app-surface px-3 py-2 text-xs text-txt-primary outline-none focus:border-sky-500"
                    >
                      {FONT_PRESETS.map((f) => (
                        <option key={f} value={f}>
                          {f.split(',')[0].replace(/"/g, '')}
                        </option>
                      ))}
                      <option value="custom">Custom...</option>
                    </select>
                    <input
                      type="text"
                      value={fontFamily}
                      onChange={(e) => setFontFamily(e.target.value)}
                      placeholder="Enter custom font family..."
                      className="w-full rounded-lg border border-border-subtle bg-app-input px-3 py-2 font-mono text-xs text-txt-primary outline-none focus:border-sky-500"
                    />
                  </div>

                  {/* Cursor Style & Scrollback */}
                  <div className="grid grid-cols-2 gap-3">
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

                  {/* Session Exit Action */}
                  <div className="space-y-2 pt-2 border-t border-border-subtle">
                    <div>
                      <label className="text-xs font-medium text-txt-primary">Vid utloggning / avslutad session</label>
                      <p className="text-[11px] text-txt-muted">Välj vad som ska ske när en SSH-session eller lokal terminal avslutas.</p>
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
                          <span>Återanslut (Standard)</span>
                        </div>
                        <span className="text-[11px] text-txt-muted leading-tight">
                          Visar snabbknappar för att återansluta direkt eller stänga fliken.
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
                          <span>Stäng flik direkt</span>
                        </div>
                        <span className="text-[11px] text-txt-muted leading-tight">
                          Stänger fliken automatiskt vid ren utloggning (kod 0).
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
                          <Terminal className="h-3.5 w-3.5 text-slate-400" />
                          <span>Behåll öppen</span>
                        </div>
                        <span className="text-[11px] text-txt-muted leading-tight">
                          Lämna terminalen öppen utan snabbknappar (klassiskt läge).
                        </span>
                      </label>
                    </div>
                  </div>

                  {/* Terminal Preview */}
                  <div className="space-y-1.5 pt-2">
                    <label className="text-[11px] font-semibold text-txt-muted uppercase tracking-wider">
                      Terminal Live Preview
                    </label>
                    <div
                      className={`rounded-lg border p-3 font-mono transition-colors shadow-inner ${
                        theme === 'light'
                          ? 'border-border-subtle bg-white text-slate-900'
                          : 'border-border-subtle bg-black/40 text-slate-100'
                      }`}
                      style={{
                        fontFamily: fontFamily || 'monospace',
                        fontSize: `${fontSize}px`,
                        lineHeight: '1.45',
                      }}
                    >
                      <div className="text-emerald-400">$ uname -srm</div>
                      <div>Linux 6.1.0-custom x86_64</div>
                      <div className="text-sky-400">sshs3 session active. Ready.</div>
                    </div>
                  </div>
                </div>
              )}

              {/* Category: Files & Storage */}
              {activeCategory === 'files' && (
                <div className="space-y-4">
                  {/* Default Conflict Policy */}
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-txt-primary">
                      Default Conflict Resolution for File Transfers
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { id: 'ask', label: 'Ask each time (Dialog)', desc: 'Show a prompt when files collide' },
                        { id: 'overwrite', label: 'Overwrite', desc: 'Replace destination file' },
                        { id: 'rename', label: 'Rename automatically', desc: 'Appends (1), (2), etc.' },
                        { id: 'skip', label: 'Skip existing files', desc: 'Ignore files that already exist' },
                      ].map((opt) => (
                        <label
                          key={opt.id}
                          className={`flex flex-col gap-0.5 rounded-lg border p-3 cursor-pointer transition-colors ${
                            defaultConflictPolicy === opt.id
                              ? 'border-sky-500 bg-sky-500/15 text-sky-200'
                              : 'border-border-subtle bg-app-surface hover:bg-app-surface-hover text-txt-secondary'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <input
                              type="radio"
                              name="conflictPolicy"
                              checked={defaultConflictPolicy === opt.id}
                              onChange={() => setDefaultConflictPolicy(opt.id as any)}
                              className="hidden"
                            />
                            <span className="font-semibold text-xs text-txt-primary">{opt.label}</span>
                          </div>
                          <span className="text-[11px] text-txt-muted">{opt.desc}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2 pt-2 border-t border-border-subtle">
                    <label className="flex items-center gap-2.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={showHiddenFiles}
                        onChange={(e) => setShowHiddenFiles(e.target.checked)}
                        className="h-4 w-4 rounded border-border-subtle text-sky-600 focus:ring-sky-500"
                      />
                      <span className="text-xs text-txt-primary">Show hidden files and dotfiles (.git, .env, etc.)</span>
                    </label>

                    <label className="flex items-center gap-2.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={confirmBeforeDelete}
                        onChange={(e) => setConfirmBeforeDelete(e.target.checked)}
                        className="h-4 w-4 rounded border-border-subtle text-sky-600 focus:ring-sky-500"
                      />
                      <span className="text-xs text-txt-primary">Confirm before deleting files and folders</span>
                    </label>
                  </div>

                  {/* Dotfiles Pool (opt-in) */}
                  <div className="space-y-2 pt-2 border-t border-border-subtle">
                    <label className="flex items-center gap-2.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={dotfilesPoolEnabled}
                        onChange={(e) => setDotfilesPoolEnabled(e.target.checked)}
                        className="h-4 w-4 rounded border-border-subtle text-sky-600 focus:ring-sky-500"
                      />
                      <span className="text-xs text-txt-primary">
                        Enable dotfiles pool sync (off by default)
                      </span>
                    </label>
                    <p className="pl-6 text-[11px] text-txt-muted leading-relaxed">
                      Keeps chosen dotfiles (.bashrc, .vimrc, etc.) present on servers you connect to. Disabled
                      here, nothing runs. Even when enabled, a host only syncs after you explicitly assign it a
                      pool and a sync policy in its connection profile.
                    </p>
                    {dotfilesPoolEnabled && (
                      <button
                        type="button"
                        onClick={() => setPoolManagerOpen(true)}
                        className="ml-6 flex items-center gap-1.5 rounded-lg border border-border-subtle bg-app-surface px-2.5 py-1.5 text-xs text-sky-400 hover:bg-app-surface-hover transition-colors"
                      >
                        <FileCode className="h-3.5 w-3.5" />
                        Manage Dotfile Pools
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Category: Security & Smartcard */}
              {activeCategory === 'security' && (
                <div className="space-y-4">
                  {/* OS SafeStorage */}
                  <div className="rounded-lg border border-border-subtle bg-app-surface p-3.5 space-y-2">
                    <div className="flex items-center gap-2 text-emerald-400">
                      <Lock className="h-4 w-4" />
                      <span className="font-semibold text-xs">OS Keychain Encryption Active</span>
                    </div>
                    <p className="text-[11px] text-txt-muted leading-relaxed">
                      All stored passwords, SSH passphrases, and S3 credentials are encrypted via Electron safeStorage
                      (libsecret on Linux, DPAPI on Windows, Keychain on macOS) before persisting to disk.
                    </p>
                  </div>

                  {/* Smartcard & PKCS#11 Detection */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium text-txt-primary">
                        Detected PKCS#11 Hardware Token Libraries
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          setDetectingSmartcard(true);
                          void window.multissh
                            ?.smartcardDetect?.()
                            ?.then((libs) => {
                              if (libs) setSmartcardLibs(libs.filter((l) => l.exists));
                            })
                            ?.finally(() => setDetectingSmartcard(false));
                        }}
                        className="text-[11px] text-sky-400 hover:underline"
                      >
                        Rescan
                      </button>
                    </div>

                    {detectingSmartcard ? (
                      <div className="py-4 text-center text-xs text-txt-muted">Scanning for PKCS#11 modules...</div>
                    ) : smartcardLibs.length === 0 ? (
                      <div className="rounded-lg border border-border-subtle bg-app-surface-subtle p-4 text-center text-xs text-txt-muted">
                        No hardware token modules automatically detected on system paths. You can still manually specify
                        a PKCS#11 library path in your SSH profiles.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {smartcardLibs.map((lib) => (
                          <div
                            key={lib.path}
                            className="flex items-center justify-between rounded-lg border border-border-subtle bg-app-surface p-2.5 text-xs"
                          >
                            <div className="min-w-0 pr-2">
                              <div className="flex items-center gap-1.5 font-medium text-txt-primary">
                                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                                <span>{lib.name}</span>
                              </div>
                              <div className="truncate font-mono text-[10px] text-txt-muted">{lib.path}</div>
                            </div>
                            <span className="rounded bg-sky-500/10 px-2 py-0.5 text-[10px] font-medium text-sky-400 shrink-0">
                              Available
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Category: Keyboard Shortcuts */}
              {activeCategory === 'shortcuts' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="relative flex-1">
                      <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-txt-muted" />
                      <input
                        type="text"
                        placeholder="Search keyboard shortcuts..."
                        value={shortcutSearch}
                        onChange={(e) => setShortcutSearch(e.target.value)}
                        className="w-full rounded-lg border border-border-subtle bg-app-surface py-1.5 pl-8 pr-3 text-xs text-txt-primary outline-none focus:border-sky-500 placeholder-txt-muted"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleResetShortcuts}
                      className="flex items-center gap-1.5 rounded-lg border border-border-subtle bg-app-surface px-2.5 py-1.5 text-xs font-medium text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary shrink-0 transition-colors"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      <span>Reset Defaults</span>
                    </button>
                  </div>

                  <div className="max-h-[330px] space-y-1.5 overflow-y-auto pr-1">
                    {filteredShortcuts.map((def) => {
                      const currentKey = shortcuts[def.id] || def.defaultKeys;
                      const isRecording = recordingAction === def.id;

                      return (
                        <div
                          key={def.id}
                          className="flex items-center justify-between rounded-lg border border-border-subtle bg-app-surface px-3 py-2 text-xs"
                        >
                          <div>
                            <div className="font-medium text-txt-primary">{def.name}</div>
                            <div className="text-[10px] text-txt-muted">{def.category}</div>
                          </div>

                          <div>
                            {isRecording ? (
                              <button
                                type="button"
                                onKeyDown={(e) => handleKeyDownRecord(e, def.id)}
                                autoFocus
                                className="rounded-md border border-sky-500 bg-sky-950 px-2.5 py-1 font-mono text-xs text-sky-300 outline-none animate-pulse"
                              >
                                Press keys (Esc to cancel)...
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setRecordingAction(def.id)}
                                className="rounded-md border border-border-subtle bg-app-input px-2.5 py-1 font-mono text-xs text-txt-primary hover:border-sky-500 hover:text-sky-400 transition-colors"
                              >
                                {currentKey}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-end gap-2 border-t border-border-subtle bg-app-surface px-5 py-3">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-border-subtle px-3.5 py-1.5 text-xs font-medium text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-lg bg-sky-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-sky-500 shadow-sm transition-colors"
              >
                Save Settings
              </button>
            </div>
          </form>
        </div>
      </div>

      <DotfilePoolManagerModal open={poolManagerOpen} onClose={() => setPoolManagerOpen(false)} />
    </div>
  );
};

export default SettingsModal;
