import type { SSHConnectionConfig, LocalShellType } from './ssh';
import type { StorageType } from './storage';

export type SplitLayout = 'single' | 'split-vertical' | 'split-horizontal' | 'grid-2x2';

export interface TerminalPaneConfig {
  id: string;
  config?: SSHConnectionConfig;
  /** True when this pane runs a local shell instead of an SSH connection. */
  local?: boolean;
  /** Windows only: which local shell to spawn when `local` is set. */
  shellType?: LocalShellType;
}

export interface SavedTab {
  id: string;
  type: 'terminal' | 'filemanager';
  title: string;
  config?: SSHConnectionConfig;
  /** True when this tab runs a local shell instead of an SSH connection. */
  local?: boolean;
  /** Windows only: which local shell to spawn when `local` is set. */
  shellType?: LocalShellType;
  splitLayout?: SplitLayout;
  panes?: TerminalPaneConfig[];
  activePaneId?: string;
}

export interface SavedPaneState {
  sourceType: StorageType;
  providerId: string;
  label: string;
  path: string;
}

export interface SessionData {
  tabs: SavedTab[];
  activeTabId: string;
  lastPaths?: Record<string, string>;
  panes?: {
    left: SavedPaneState;
    right: SavedPaneState;
  };
}
