import { describe, it, expect, vi } from 'vitest';

const { mockStart } = vi.hoisted(() => ({
  mockStart: vi.fn().mockResolvedValue({ on: vi.fn() }),
}));

vi.mock('../../src/main/storage/sftp/OpenSshSftpProcess', () => ({
  OpenSshSftpProcess: class {
    start = mockStart;
  },
}));

import { OpenSshSftpClientAdapter } from '../../src/main/storage/sftp/OpenSshSftpClientAdapter';

describe('OpenSshSftpClientAdapter shared control socket', () => {
  it('hands the given socket to the first connect only', async () => {
    const adapter = new OpenSshSftpClientAdapter(
      { id: 'a', host: 'h', port: 22, username: 'u', authType: 'agent' },
      undefined,
      undefined,
      undefined,
      undefined,
      '/tmp/terminal.sock'
    );
    await adapter.connect();
    await adapter.connect();
    expect(mockStart.mock.calls[0][0].controlPath).toBe('/tmp/terminal.sock');
    expect(mockStart.mock.calls[1][0].controlPath).toBeUndefined();
  });
});
