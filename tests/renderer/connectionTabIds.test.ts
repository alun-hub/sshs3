import { describe, it, expect } from 'vitest';
import { protocolPanelId, protocolTabId } from '../../src/renderer/src/components/ConnectionModal/connectionTabIds';

describe('connectionTabIds', () => {
  it('gives every tab its own id under the dialog prefix', () => {
    const ids = (['ssh', 's3', 'k8s'] as const).map((tab) => protocolTabId(':r1:', tab));
    expect(new Set(ids).size).toBe(3);
    for (const id of ids) expect(id.startsWith(':r1:')).toBe(true);
  });

  it('never gives a tab the id of the panel', () => {
    for (const tab of ['ssh', 's3', 'k8s'] as const) {
      expect(protocolTabId(':r1:', tab)).not.toBe(protocolPanelId(':r1:'));
    }
  });

  it('keeps two open dialogs apart through their prefixes', () => {
    expect(protocolTabId(':r1:', 'ssh')).not.toBe(protocolTabId(':r2:', 'ssh'));
    expect(protocolPanelId(':r1:')).not.toBe(protocolPanelId(':r2:'));
  });
});
