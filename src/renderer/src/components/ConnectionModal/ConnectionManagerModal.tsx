import React, { useState } from 'react';
import type { Tab, ConnectionManagerModalProps } from './types';
import { ConnectionManagerModalBody } from './ConnectionManagerModalBody';

export type { Tab };

/**
 * The Connection Manager dialog. It is only mounted while it is open.
 *
 * Its callers (App, DirectorySyncModal, DualPaneExplorer) keep it rendered with an `open` prop, and it used
 * to run its hooks even when closed: the IPC subscriptions for Team Vault sync and pull events refetched the
 * tab list for nobody to see, and every sync status event re-rendered the hidden dialog. Now everything in
 * `ConnectionManagerModalBody` starts fresh on open and is gone on close.
 */
export const ConnectionManagerModal: React.FC<ConnectionManagerModalProps> = (props) => {
  // Kept here, not in the body: it only exists while the dialog is open, but these two have always survived
  // a close and a reopen (a collapsed folder stays collapsed, a team's folder browser stays where it was).
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [teamFolderPaths, setTeamFolderPaths] = useState<Record<string, string[]>>({});

  if (!props.open) return null;
  return (
    <ConnectionManagerModalBody
      {...props}
      collapsedGroups={collapsedGroups}
      setCollapsedGroups={setCollapsedGroups}
      teamFolderPaths={teamFolderPaths}
      setTeamFolderPaths={setTeamFolderPaths}
    />
  );
};

export default ConnectionManagerModal;
