import type { SSHConnectionConfig } from './ssh';
import type { StorageType } from './storage';

export type SplitLayout = 'single' | 'split-vertical' | 'split-horizontal' | 'grid-2x2';

export interface TerminalPaneConfig {
  id: string;
  config?: SSHConnectionConfig;
}

export interface SavedTab {
  id: string;
  type: 'terminal' | 'filemanager';
  title: string;
  config?: SSHConnectionConfig;
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
