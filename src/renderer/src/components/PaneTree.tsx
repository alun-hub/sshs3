import React from 'react';
import { Columns2, RefreshCw, Rows2, Terminal, X } from 'lucide-react';
import { TerminalView } from './TerminalView';
import type { AppSettings } from '@shared/types/settings';
import type { LocalShellType } from '@shared/types/ssh';
import type { PaneNode, PaneOrientation } from '@shared/types/session';

/** Buttons for launching a local shell (no SSH connection) in a pane. */
const LocalTerminalButtons: React.FC<{
  platform: string;
  onOpen: (shellType?: LocalShellType, wslDistro?: string) => void;
}> = ({
  platform,
  onOpen,
}) => {
  const [pwshAvailable, setPwshAvailable] = React.useState(false);
  const [wslAvailable, setWslAvailable] = React.useState(false);
  const [wslDistros, setWslDistros] = React.useState<string[]>([]);

  React.useEffect(() => {
    if (platform !== 'win32') return;
    void window.multissh.detectLocalShells?.().then((res) => {
      setPwshAvailable(Boolean(res?.pwsh));
      setWslAvailable(Boolean(res?.wsl));
      setWslDistros(res?.wslDistros || []);
    });
  }, [platform]);

  if (platform !== 'win32') {
    return (
      <button
        type="button"
        onClick={() => onOpen()}
        className="rounded-lg border border-border-subtle px-3 py-1 text-xs font-medium text-txt-secondary hover:bg-app-surface-hover transition-colors"
      >
        Open Local Terminal
      </button>
    );
  }
  return (
    <div className="flex flex-wrap items-center justify-center gap-1.5">
      <button
        type="button"
        onClick={() => onOpen('cmd')}
        className="rounded-lg border border-border-subtle px-3 py-1 text-xs font-medium text-txt-secondary hover:bg-app-surface-hover transition-colors"
      >
        Command Prompt
      </button>
      <button
        type="button"
        onClick={() => onOpen('powershell')}
        className="rounded-lg border border-border-subtle px-3 py-1 text-xs font-medium text-txt-secondary hover:bg-app-surface-hover transition-colors"
      >
        PowerShell
      </button>
      {pwshAvailable && (
        <button
          type="button"
          onClick={() => onOpen('pwsh')}
          title="PowerShell 7+ (pwsh.exe)"
          className="rounded-lg border border-border-subtle px-3 py-1 text-xs font-medium text-txt-secondary hover:bg-app-surface-hover transition-colors"
        >
          PowerShell 7
        </button>
      )}
      {wslAvailable &&
        (wslDistros.length > 1 ? (
          wslDistros.map((distro) => (
            <button
              key={distro}
              type="button"
              onClick={() => onOpen('wsl', distro)}
              title={`Windows Subsystem for Linux (${distro})`}
              className="rounded-lg border border-border-subtle px-3 py-1 text-xs font-medium text-txt-secondary hover:bg-app-surface-hover transition-colors"
            >
              {distro}
            </button>
          ))
        ) : (
          <button
            type="button"
            onClick={() => onOpen('wsl', wslDistros[0])}
            title={
              wslDistros[0]
                ? `Windows Subsystem for Linux (${wslDistros[0]})`
                : 'Windows Subsystem for Linux (wsl.exe)'
            }
            className="rounded-lg border border-border-subtle px-3 py-1 text-xs font-medium text-txt-secondary hover:bg-app-surface-hover transition-colors"
          >
            {wslDistros[0] ? `WSL (${wslDistros[0]})` : 'WSL'}
          </button>
        ))}
    </div>
  );
};

export interface PaneTreeViewProps {
  node: PaneNode;
  isActive: boolean;
  activePaneId?: string;
  totalPanes: number;
  settings: AppSettings;
  platform: string;
  onSelectPane: (paneId: string) => void;
  onSplitPane: (paneId: string, orientation: PaneOrientation) => void;
  onClosePane: (paneId: string) => void;
  onChangeConnection: (paneId: string) => void;
  onOpenLocalTerminal: (paneId: string, shellType?: LocalShellType, wslDistro?: string) => void;
  onCloseTab: () => void;
  onTitleChange?: (paneId: string, title: string) => void;
  /** Remote directory to `cd` into once this specific pane's shell prompt appears. */
  initialCwdPaneId?: string;
  initialCwd?: string;
}

export const PaneTreeView: React.FC<PaneTreeViewProps> = (props) => {
  const { node } = props;

  if (node.type === 'split') {
    return (
      <div className={`flex h-full w-full ${node.orientation === 'row' ? 'flex-row' : 'flex-col'}`}>
        {node.children.map((child, i) => (
          <div
            key={child.id}
            className={`relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden ${
              i > 0
                ? node.orientation === 'row'
                  ? 'border-l border-border-subtle'
                  : 'border-t border-border-subtle'
                : ''
            }`}
          >
            <PaneTreeView {...props} node={child} />
          </div>
        ))}
      </div>
    );
  }

  const { isActive, activePaneId, totalPanes, settings, platform } = props;
  const isSole = totalPanes === 1;
  const isFocused = activePaneId === node.id;

  return (
    <div
      data-testid={`terminal-pane-${node.id}`}
      onMouseDownCapture={() => props.onSelectPane(node.id)}
      className="relative flex h-full w-full flex-col overflow-hidden"
    >
      <div
        className={`flex h-6 shrink-0 items-center justify-between border-b px-2 text-[11px] ${
          isFocused && !isSole
            ? 'border-sky-500/40 bg-sky-500/5 text-txt-primary'
            : 'border-border-subtle bg-app-surface text-txt-muted'
        }`}
      >
        <span className="truncate font-mono">
          {(() => {
            const baseName =
              node.config?.name ||
              (node.local
                ? node.shellType === 'wsl'
                  ? node.wslDistro
                    ? `WSL: ${node.wslDistro}`
                    : 'WSL'
                  : 'Local Shell'
                : 'No connection');
            return node.dynamicHost ? `${baseName} → ${node.dynamicHost}` : baseName;
          })()}
        </span>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            title="Change connection"
            data-testid={`change-pane-${node.id}`}
            onClick={() => props.onChangeConnection(node.id)}
            className="rounded p-0.5 hover:bg-app-surface-hover hover:text-txt-primary transition-colors"
          >
            <RefreshCw className="h-3 w-3" />
          </button>
          <button
            type="button"
            title="Split right"
            data-testid={`split-row-${node.id}`}
            onClick={() => props.onSplitPane(node.id, 'row')}
            className="rounded p-0.5 hover:bg-app-surface-hover hover:text-txt-primary transition-colors"
          >
            <Columns2 className="h-3 w-3" />
          </button>
          <button
            type="button"
            title="Split down"
            data-testid={`split-column-${node.id}`}
            onClick={() => props.onSplitPane(node.id, 'column')}
            className="rounded p-0.5 hover:bg-app-surface-hover hover:text-txt-primary transition-colors"
          >
            <Rows2 className="h-3 w-3" />
          </button>
          {!isSole && (
            <button
              type="button"
              title="Close this pane"
              data-testid={`close-pane-${node.id}`}
              onClick={() => props.onClosePane(node.id)}
              className="rounded p-0.5 hover:bg-red-500/20 hover:text-red-400 transition-colors"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0">
        {node.config ? (
          <TerminalView
            config={node.config}
            isActive={isActive}
            fontSize={settings.terminalFontSize}
            fontFamily={settings.terminalFontFamily}
            theme={settings.theme}
            initialCwd={props.initialCwdPaneId === node.id ? props.initialCwd : undefined}
            sessionExitAction={settings.sessionExitAction}
            copyOnSelect={settings.copyOnSelect}
            onCloseTab={isSole ? props.onCloseTab : () => props.onClosePane(node.id)}
            onTitleChange={props.onTitleChange ? (title) => props.onTitleChange!(node.id, title) : undefined}
          />
        ) : node.local ? (
          <TerminalView
            local
            shellType={node.shellType}
            wslDistro={node.wslDistro}
            isActive={isActive}
            fontSize={settings.terminalFontSize}
            fontFamily={settings.terminalFontFamily}
            theme={settings.theme}
            sessionExitAction={settings.sessionExitAction}
            copyOnSelect={settings.copyOnSelect}
            onCloseTab={isSole ? props.onCloseTab : () => props.onClosePane(node.id)}
            onTitleChange={props.onTitleChange ? (title) => props.onTitleChange!(node.id, title) : undefined}
          />
        ) : isSole ? (
          <div className="flex h-full flex-1 flex-col items-center justify-center gap-3 bg-app text-txt-muted">
            <Terminal className="h-10 w-10 text-txt-muted" />
            <p className="text-sm text-txt-secondary">No connection selected for this tab</p>
            <button
              type="button"
              onClick={() => props.onChangeConnection(node.id)}
              className="rounded-lg bg-sky-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-sky-500 shadow-sm transition-colors"
            >
              Select SSH Connection
            </button>
            <LocalTerminalButtons
              platform={platform}
              onOpen={(shellType, wslDistro) => props.onOpenLocalTerminal(node.id, shellType, wslDistro)}
            />
          </div>
        ) : (
          <div className="flex h-full flex-1 flex-col items-center justify-center gap-2 text-txt-muted bg-app">
            <p className="text-xs text-txt-secondary">No connection selected</p>
            <button
              type="button"
              onClick={() => props.onChangeConnection(node.id)}
              className="rounded-lg bg-sky-600 px-3 py-1 text-xs font-medium text-white hover:bg-sky-500 shadow-sm transition-colors"
            >
              Select SSH Connection
            </button>
            <LocalTerminalButtons
              platform={platform}
              onOpen={(shellType, wslDistro) => props.onOpenLocalTerminal(node.id, shellType, wslDistro)}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default PaneTreeView;
