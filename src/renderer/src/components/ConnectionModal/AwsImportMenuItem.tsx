import React, { useState } from 'react';
import { Cloud } from 'lucide-react';
import type { SSHConnectionConfig } from '@shared/types/ssh';
import { buildProfilesFromInstances } from '@shared/ssmProfileFactory';
import { AwsInstancePickerModal, type AwsPickResult } from '../AwsInstancePickerModal';

interface Props {
  /** Called after the profiles were saved (or the dialog closed): refresh the list and close the menu. */
  onDone: (imported: number) => void;
  /** Saved SSH profiles: instances that already have an SSM profile are not imported twice (instance ids are unique in AWS). */
  profiles: readonly SSHConnectionConfig[];
}

/** "Import from AWS…" entry of the Import / Export menu: pick SSM-managed instances and save them as SSM profiles. */
export const AwsImportMenuItem: React.FC<Props> = ({ onDone, profiles }) => {
  const [open, setOpen] = useState(false);

  const save = async (r: AwsPickResult) => {
    const created = buildProfilesFromInstances(r.instances, { sso: r.sso, region: r.region, username: r.username, existing: new Set(profiles.filter((p) => p.ssm?.enabled).map((p) => p.host)) }).map(
      (p) => ({ ...p, group: r.folder })
    );
    if (r.folder) await window.multissh.profilesSaveFolder(r.folder).catch(() => {});
    for (const p of created) await window.multissh.profilesSaveSSH(p);
    setOpen(false);
    onDone(created.length);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary"
      >
        <Cloud className="h-3.5 w-3.5 text-sky-400" />
        <span>Import from AWS…</span>
      </button>
      {open && <AwsInstancePickerModal mode="multi" onClose={() => { setOpen(false); onDone(0); }} onPick={save} />}
    </>
  );
};
