import type { SSHConnectionConfig } from './ssh';
import type { StorageType } from './storage';

export interface SavedTab {
  id: string;
  type: 'terminal' | 'filemanager';
  title: string;
  config?: SSHConnectionConfig;
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
