import { describe, it, expect } from 'vitest';
import { formatDateTime } from '../../src/renderer/src/lib/dateFormat';
import { formatDateTime as formatDateTimeReExported } from '../../src/renderer/src/lib/format';

// LOW finding (code review): three near-identical formatDateTime
// implementations existed (lib/format.ts, lib/dateFormat.ts, and an ad-hoc
// copy in SyncSettingsPanel.tsx) with different edge-case behavior.
// lib/dateFormat.ts is now the one canonical implementation.
describe('formatDateTime', () => {
  it('formats a Date object as yyyy-mm-dd HH:mm', () => {
    const d = new Date(2026, 8, 27, 14, 5); // month is 0-indexed: September
    expect(formatDateTime(d)).toBe('2026-09-27 14:05');
  });

  it('formats an ISO string the same way as an equivalent Date', () => {
    const iso = '2026-01-02T03:04:00';
    expect(formatDateTime(iso)).toBe(formatDateTime(new Date(iso)));
  });

  it('returns "—" for missing input', () => {
    expect(formatDateTime(undefined)).toBe('—');
    expect(formatDateTime(null)).toBe('—');
    expect(formatDateTime('')).toBe('—');
  });

  it('returns the original input unchanged for an unparseable date', () => {
    expect(formatDateTime('not-a-date')).toBe('not-a-date');
  });

  it('is re-exported unchanged from lib/format.ts', () => {
    expect(formatDateTimeReExported).toBe(formatDateTime);
  });
});
