import { formatDateTime } from '../../lib/format';

/** What a team tab's sync dot stands for: its tooltip, and the same words for a screen reader. */
export function teamSyncLabel(syncing: boolean, lastSyncAt?: string): string {
  if (syncing) return 'Syncing now';
  return lastSyncAt ? `Last synced ${formatDateTime(lastSyncAt)}` : 'Not synced yet';
}
