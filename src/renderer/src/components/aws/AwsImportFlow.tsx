import React, { useRef } from 'react';
import { buildProfilesFromInstances } from '@shared/ssmProfileFactory';
import type { SSHConnectionConfig } from '@shared/types/ssh';
import { AwsInstancePickerModal, type AwsPickResult } from '../AwsInstancePickerModal';

interface Props {
  /** Saved SSH profiles: nodes that already have an SSM profile are not imported twice (instance ids are unique in AWS). */
  profiles: readonly SSHConnectionConfig[];
  /** Called with the number of profiles created (0 when the dialog was cancelled). */
  onDone: (imported: number) => void;
}

/**
 * "Add from AWS": the instance picker plus saving the chosen nodes as SSM profiles. Used from the connection
 * manager and from the AWS badge in the top bar, so both behave the same.
 */
export const AwsImportFlow: React.FC<Props> = ({ profiles, onDone }) => {
  // Profiles saved by this dialog so far: a retry after a failed save must not create them twice.
  const savedIds = useRef(new Set<string>());

  const save = async (r: AwsPickResult) => {
    const existing = new Set([...profiles.filter((p) => p.ssm?.enabled).map((p) => p.host), ...savedIds.current]);
    const created = buildProfilesFromInstances(r.instances, { sso: r.sso, region: r.region, username: r.username, existing }).map((p) => ({ ...p, group: r.folder }));
    if (r.folder) await window.multissh.profilesSaveFolder(r.folder).catch(() => {});
    for (const p of created) {
      await window.multissh.profilesSaveSSH(p);
      savedIds.current.add(p.host);
    }
    onDone(created.length);
  };

  return <AwsInstancePickerModal mode="multi" onClose={() => onDone(0)} onPick={save} />;
};
