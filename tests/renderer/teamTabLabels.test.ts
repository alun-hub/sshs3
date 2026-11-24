import { describe, it, expect } from 'vitest';
import { teamSyncLabel } from '../../src/renderer/src/components/ConnectionModal/teamTabLabels';
import { formatDateTime } from '../../src/renderer/src/lib/format';

describe('teamSyncLabel', () => {
  const syncedAt = '2026-11-23T21:30:00Z';

  it('says a sync is running, even when there is an earlier one', () => {
    expect(teamSyncLabel(true)).toBe('Syncing now');
    expect(teamSyncLabel(true, syncedAt)).toBe('Syncing now');
  });

  it('gives the time of the last sync in the app date format', () => {
    expect(teamSyncLabel(false, syncedAt)).toBe(`Last synced ${formatDateTime(syncedAt)}`);
  });

  it('says so when the team has never synced', () => {
    expect(teamSyncLabel(false)).toBe('Not synced yet');
    expect(teamSyncLabel(false, '')).toBe('Not synced yet');
  });
});
