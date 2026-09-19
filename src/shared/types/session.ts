import type { SSHConnectionConfig, LocalShellType } from './ssh';
import type { StorageType } from './storage';

/** 'row' places children side by side (a vertical divider); 'column' stacks them (a horizontal divider). */
export type PaneOrientation = 'row' | 'column';

export interface PaneLeaf {
  type: 'leaf';
  id: string;
  config?: SSHConnectionConfig;
  /** True when this pane runs a local shell instead of an SSH connection. */
  local?: boolean;
  /** Windows only: which local shell to spawn when `local` is set. */
  shellType?: LocalShellType;
}

export interface PaneSplit {
  type: 'split';
  id: string;
  orientation: PaneOrientation;
  children: PaneNode[];
}

/**
 * A recursive tree of terminal panes, mirroring Konsole's ViewSplitter model: splitting wraps an
 * existing leaf (or inserts a sibling into an already-matching-orientation split) without ever
 * recreating it, and closing a pane collapses any split left with a single child back into that
 * child so no dead single-child nodes accumulate.
 */
export type PaneNode = PaneLeaf | PaneSplit;

export interface SavedTab {
  id: string;
  type: 'terminal' | 'filemanager';
  title: string;
  /** Terminal tabs always carry a pane tree, even when it's a single leaf. */
  paneTree?: PaneNode;
  /** The pane the user last interacted with; keyboard shortcuts (split/close) target this pane. */
  activePaneId?: string;
  initialCwd?: string;
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
