import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Columns2, RefreshCw, Rows2, Terminal, X } from 'lucide-react';
import { TerminalView } from './TerminalView';
import { K8sLogView } from './K8sLogView';
import { collectLeaves } from '../lib/paneTree';
import type { AppSettings } from '@shared/types/settings';
import type { LocalShellType } from '@shared/types/ssh';
import type { PaneLeaf, PaneNode, PaneOrientation } from '@shared/types/session';

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

interface PaneTreeLayoutProps extends PaneTreeViewProps {
  getPaneContainer: (paneId: string) => HTMLDivElement;
}

const PaneSlot: React.FC<{
  paneId: string;
  getPaneContainer: (paneId: string) => HTMLDivElement;
  onSelectPane: (paneId: string) => void;
}> = ({ paneId, getPaneContainer, onSelectPane }) => {
  const slotRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const slotEl = slotRef.current;
    const container = getPaneContainer(paneId);
    if (slotEl && container) {
      if (container.parentElement !== slotEl) {
        slotEl.appendChild(container);
      }
    }
  });

  return (
    <div
      ref={slotRef}
      onMouseDownCapture={() => onSelectPane(paneId)}
      className="flex-1 min-h-0 relative"
    />
  );
};

const PaneTreeLayout: React.FC<PaneTreeLayoutProps> = (props) => {
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
            <PaneTreeLayout {...props} node={child} />
          </div>
        ))}
      </div>
    );
  }

  const { activePaneId, totalPanes } = props;
  const isSole = totalPanes === 1;
  const isFocused = activePaneId === node.id;

  return (
    <div
      data-testid={`terminal-pane-${node.id}`}
      onMouseDownCapture={() => props.onSelectPane(node.id)}
      className={`relative flex h-full w-full flex-col overflow-hidden transition-all duration-150 ${
        isFocused && !isSole
          ? 'ring-1 ring-inset ring-sky-500/60 shadow-[inset_0_0_12px_rgba(14,165,233,0.06)]'
          : ''
      }`}
    >
      <div
        className={`flex h-6.5 shrink-0 items-center justify-between border-b px-2.5 text-[11px] transition-colors ${
          isFocused && !isSole
            ? 'border-sky-500/50 bg-sky-500/5 text-txt-primary font-medium'
            : 'border-border-subtle bg-app-surface text-txt-muted'
        }`}
      >
        <div className="flex items-center min-w-0 mr-2">
          {isFocused && !isSole && (
            <span className="relative flex h-2 w-2 mr-1.5 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-sky-500" />
            </span>
          )}
          <span className="truncate font-mono">
            {(() => {
              const baseName =
                node.config?.name ||
                (node.k8sTarget && `${node.k8sTarget.podName} / ${node.k8sTarget.containerName}`) ||
                (node.k8sLogTarget && `Logs: ${node.k8sLogTarget.podName} / ${node.k8sLogTarget.containerName}`) ||
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
        </div>
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

      <PaneSlot paneId={node.id} getPaneContainer={props.getPaneContainer} onSelectPane={props.onSelectPane} />
    </div>
  );
};

const PaneLeafContent: React.FC<{
  leaf: PaneLeaf;
  isActive: boolean;
  totalPanes: number;
  settings: AppSettings;
  platform: string;
  initialCwdPaneId?: string;
  initialCwd?: string;
  onCloseTab: () => void;
  onClosePane: (paneId: string) => void;
  onChangeConnection: (paneId: string) => void;
  onOpenLocalTerminal: (paneId: string, shellType?: LocalShellType, wslDistro?: string) => void;
  onTitleChange?: (paneId: string, title: string) => void;
  onSelectPane: (paneId: string) => void;
}> = ({
  leaf,
  isActive,
  totalPanes,
  settings,
  platform,
  initialCwdPaneId,
  initialCwd,
  onCloseTab,
  onClosePane,
  onChangeConnection,
  onOpenLocalTerminal,
  onTitleChange,
  onSelectPane,
}) => {
  const isSole = totalPanes === 1;
  let content: React.ReactNode;

  if (leaf.config) {
    content = (
      <TerminalView
        config={leaf.config}
        isActive={isActive}
        fontSize={settings.terminalFontSize}
        fontFamily={settings.terminalFontFamily}
        theme={settings.theme}
        initialCwd={initialCwdPaneId === leaf.id ? initialCwd : undefined}
        sessionExitAction={settings.sessionExitAction}
        copyOnSelect={settings.copyOnSelect}
        onCloseTab={isSole ? onCloseTab : () => onClosePane(leaf.id)}
        onTitleChange={onTitleChange ? (title) => onTitleChange(leaf.id, title) : undefined}
      />
    );
  } else if (leaf.k8sTarget) {
    content = (
      <TerminalView
        k8sTarget={leaf.k8sTarget}
        isActive={isActive}
        fontSize={settings.terminalFontSize}
        fontFamily={settings.terminalFontFamily}
        theme={settings.theme}
        sessionExitAction={settings.sessionExitAction}
        copyOnSelect={settings.copyOnSelect}
        onCloseTab={isSole ? onCloseTab : () => onClosePane(leaf.id)}
        onTitleChange={onTitleChange ? (title) => onTitleChange(leaf.id, title) : undefined}
      />
    );
  } else if (leaf.k8sLogTarget) {
    content = (
      <K8sLogView
        target={leaf.k8sLogTarget}
        isActive={isActive}
        fontSize={settings.terminalFontSize}
        fontFamily={settings.terminalFontFamily}
      />
    );
  } else if (leaf.local) {
    content = (
      <TerminalView
        local
        shellType={leaf.shellType}
        wslDistro={leaf.wslDistro}
        isActive={isActive}
        fontSize={settings.terminalFontSize}
        fontFamily={settings.terminalFontFamily}
        theme={settings.theme}
        sessionExitAction={settings.sessionExitAction}
        copyOnSelect={settings.copyOnSelect}
        onCloseTab={isSole ? onCloseTab : () => onClosePane(leaf.id)}
        onTitleChange={onTitleChange ? (title) => onTitleChange(leaf.id, title) : undefined}
      />
    );
  } else if (isSole) {
    content = (
      <div className="flex h-full flex-1 flex-col items-center justify-center gap-3 bg-app text-txt-muted">
        <Terminal className="h-10 w-10 text-txt-muted" />
        <p className="text-sm text-txt-secondary">No connection selected for this tab</p>
        <button
          type="button"
          onClick={() => onChangeConnection(leaf.id)}
          className="rounded-lg bg-sky-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-sky-500 shadow-sm transition-colors"
        >
          Select SSH Connection
        </button>
        <LocalTerminalButtons
          platform={platform}
          onOpen={(shellType, wslDistro) => onOpenLocalTerminal(leaf.id, shellType, wslDistro)}
        />
      </div>
    );
  } else {
    content = (
      <div className="flex h-full flex-1 flex-col items-center justify-center gap-2 text-txt-muted bg-app">
        <p className="text-xs text-txt-secondary">No connection selected</p>
        <button
          type="button"
          onClick={() => onChangeConnection(leaf.id)}
          className="rounded-lg bg-sky-600 px-3 py-1 text-xs font-medium text-white hover:bg-sky-500 shadow-sm transition-colors"
        >
          Select SSH Connection
        </button>
        <LocalTerminalButtons
          platform={platform}
          onOpen={(shellType, wslDistro) => onOpenLocalTerminal(leaf.id, shellType, wslDistro)}
        />
      </div>
    );
  }

  return (
    <div
      className="h-full w-full"
      onMouseDownCapture={() => onSelectPane(leaf.id)}
      onFocusCapture={() => onSelectPane(leaf.id)}
    >
      {content}
    </div>
  );
};

export const PaneTreeView: React.FC<PaneTreeViewProps> = (props) => {
  const paneContainersRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const onSelectPaneRef = useRef(props.onSelectPane);
  onSelectPaneRef.current = props.onSelectPane;

  const getPaneContainer = useCallback((paneId: string) => {
    let el = paneContainersRef.current.get(paneId);
    if (!el) {
      el = document.createElement('div');
      el.className = 'h-full w-full';
      el.addEventListener(
        'mousedown',
        () => {
          onSelectPaneRef.current(paneId);
        },
        true
      );
      el.addEventListener(
        'focusin',
        () => {
          onSelectPaneRef.current(paneId);
        },
        true
      );
      paneContainersRef.current.set(paneId, el);
    }
    return el;
  }, []);

  const leaves = useMemo(() => collectLeaves(props.node), [props.node]);

  useEffect(() => {
    const currentIds = new Set(leaves.map((l) => l.id));
    for (const [id, el] of paneContainersRef.current.entries()) {
      if (!currentIds.has(id)) {
        el.remove();
        paneContainersRef.current.delete(id);
      }
    }
  }, [leaves]);

  return (
    <>
      <PaneTreeLayout {...props} getPaneContainer={getPaneContainer} />
      {leaves.map((leaf) => {
        const container = getPaneContainer(leaf.id);
        return createPortal(
          <PaneLeafContent
            key={leaf.id}
            leaf={leaf}
            isActive={props.isActive}
            totalPanes={props.totalPanes}
            settings={props.settings}
            platform={props.platform}
            initialCwdPaneId={props.initialCwdPaneId}
            initialCwd={props.initialCwd}
            onCloseTab={props.onCloseTab}
            onClosePane={props.onClosePane}
            onChangeConnection={props.onChangeConnection}
            onOpenLocalTerminal={props.onOpenLocalTerminal}
            onTitleChange={props.onTitleChange}
            onSelectPane={props.onSelectPane}
          />,
          container,
          leaf.id
        );
      })}
    </>
  );
};

export default PaneTreeView;
