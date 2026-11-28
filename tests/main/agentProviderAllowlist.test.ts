import { describe, it, expect } from 'vitest';
import { agentProviderArgs } from '../../src/main/ssh/agentProviderAllowlist';

describe('agentProviderArgs', () => {
  it('keeps the default allow-list outside macOS', () => {
    expect(agentProviderArgs('linux')).toEqual([]);
    expect(agentProviderArgs('win32')).toEqual([]);
  });

  it('adds only the OpenSC installation to the defaults on macOS', () => {
    // Widening this lets the agent load more libraries into itself: change it deliberately.
    expect(agentProviderArgs('darwin')).toEqual(['-P', '/usr/lib*/*,/usr/local/lib*/*,/Library/OpenSC/*']);
  });
});
