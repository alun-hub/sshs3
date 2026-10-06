import type { TabItem } from '../components/TabBar';
import type { SSHConnectionConfig } from '@shared/types/ssh';
import type { PaneNode } from '@shared/types/session';
import type { K8sTerminalTarget } from '@shared/types/kubernetes';
import { sanitizePaneNode } from '@shared/sessionSanitize';
import { createLeaf } from './paneTree';

export interface AppTab extends TabItem {
  /** Terminal tabs always carry a pane tree, even when it's a single leaf. */
  paneTree?: PaneNode;
  /** The pane the user last interacted with; keyboard shortcuts (split/close) target this pane. */
  activePaneId?: string;
  initialCwd?: string;
  /** Set when opening a filemanager tab focused on a K8s container. */
  initialK8sTarget?: K8sTerminalTarget;
  /** Set when opening a filemanager tab focused on an SSH/SFTP profile. */
  initialSSHConfig?: SSHConnectionConfig;
}

/** True when a terminal tab has a single, not-yet-connected pane (safe to fill in-place instead of opening a new tab). */
export function isEmptyUnconnectedTab(tab: AppTab): boolean {
  if (tab.type !== 'terminal' || !tab.paneTree) return true;
  return tab.paneTree.type === 'leaf' && !tab.paneTree.config && !tab.paneTree.local;
}

/** Ensures every terminal tab carries a pane tree, synthesizing a single leaf for legacy/corrupted saved state. */
export function normalizeTab(tab: AppTab): AppTab {
  if (tab.type !== 'terminal') return tab;
  if (tab.paneTree) return tab;
  return { ...tab, paneTree: createLeaf(`${tab.id}-root`) };
}

export function sanitizeTabForSession(tab: AppTab): AppTab {
  if (!tab.paneTree) return tab;
  return {
    ...tab,
    paneTree: sanitizePaneNode(tab.paneTree),
  };
}
