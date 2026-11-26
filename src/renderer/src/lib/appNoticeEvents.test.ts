// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { APP_NOTICE_EVENT, showAppNotice } from './appNoticeEvents';

describe('showAppNotice', () => {
  const listeners: Array<(e: Event) => void> = [];
  afterEach(() => listeners.splice(0).forEach((l) => window.removeEventListener(APP_NOTICE_EVENT, l)));

  it('hands the message to whoever listens for the app-wide notice', () => {
    const seen = vi.fn((e: Event) => (e as CustomEvent<string>).detail);
    listeners.push(seen);
    window.addEventListener(APP_NOTICE_EVENT, seen);

    showAppNotice('Opened hosts.');
    showAppNotice('Upload of hosts failed: Permission denied');

    expect(seen).toHaveBeenCalledTimes(2);
    expect(seen.mock.results.map((r) => r.value)).toEqual(['Opened hosts.', 'Upload of hosts failed: Permission denied']);
  });

  it('does nothing when nobody listens', () => {
    expect(() => showAppNotice('x')).not.toThrow();
  });
});
