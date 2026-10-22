import { parseStoredK8sProfile } from '../ipc/ipcHelpers';
import type { K8sProfile } from '../../shared/types/kubernetes';

/** What a profile looks like on the wire: `contextName` names a kubeconfig entry of this machine only. */
function withoutContextName(profile: K8sProfile): K8sProfile {
  const { contextName: _contextName, ...rest } = profile;
  return rest;
}

export interface K8sProfilesPayload {
  profiles: K8sProfile[];
}

export function toSyncPayload(profiles: K8sProfile[]): K8sProfilesPayload {
  return { profiles: profiles.map(withoutContextName) };
}

/**
 * Validates profiles received from the remote. Entries that do not validate are dropped, and the
 * kubeconfig context name is never accepted, so a tampered remote cannot point a profile at an
 * existing local context. A remote winning a merge is layered on the local record, which keeps the
 * local `contextName`.
 */
export function fromRemotePayload(raw: unknown): K8sProfile[] {
  const entries: unknown[] = Array.isArray((raw as K8sProfilesPayload | null)?.profiles)
    ? (raw as K8sProfilesPayload).profiles
    : [];
  const profiles: K8sProfile[] = [];
  for (const entry of entries) {
    try {
      profiles.push(withoutContextName(parseStoredK8sProfile(entry)));
    } catch {
      // Drop an entry that fails validation.
    }
  }
  return profiles;
}
