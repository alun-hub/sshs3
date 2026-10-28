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

describe('OpenSshSftpClientAdapter.list', () => {
  function adapterWithEntries(filenames: string[]): OpenSshSftpClientAdapter {
    const adapter = new OpenSshSftpClientAdapter({ id: 'a', host: 'h', port: 22, username: 'u', authType: 'agent' });
    const entries = filenames.map((filename) => ({
      filename,
      longname: '',
      attrs: { size: 1, isDirectory: false, isSymlink: false },
    }));
    const readdir = vi.fn().mockResolvedValueOnce(entries).mockResolvedValue(null);
    (adapter as unknown as { protocol: unknown }).protocol = {
      opendir: vi.fn().mockResolvedValue(Buffer.from('h')),
      readdir,
      close: vi.fn().mockResolvedValue(undefined),
    };
    return adapter;
  }

  it('skips entries that are not a single path component', async () => {
    const adapter = adapterWithEntries(['ok.txt', '.', '..', '../escape', 'a/b', '/etc/passwd', 'nul\0name', '']);
    const names = (await adapter.list('/data')).map((e) => e.name);
    expect(names).toEqual(['ok.txt']);
  });

  it('keeps ordinary names, including dots, spaces, backslashes and non-ASCII', async () => {
    const names = ['.hidden', 'a b', 'back\\slash', 'rapport åäö.pdf', '..dots', 'x..'];
    const listed = (await adapterWithEntries(names).list('/data')).map((e) => e.name);
    expect(listed).toEqual(names);
  });
});
