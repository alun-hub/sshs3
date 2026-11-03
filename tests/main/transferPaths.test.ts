import { describe, it, expect } from 'vitest';
import { isSamePathOnProvider } from '../../src/main/transfer/transferPaths';

describe('isSamePathOnProvider', () => {
  it('detects the same posix path despite trailing slash, dot segments and doubled slashes', () => {
    expect(isSamePathOnProvider('sftp', '/data/a.txt', '/data/a.txt')).toBe(true);
    expect(isSamePathOnProvider('sftp', '/data/a.txt', '/data//./a.txt')).toBe(true);
    expect(isSamePathOnProvider('sftp', '/data/dir', '/data/dir/')).toBe(true);
    expect(isSamePathOnProvider('s3', 'bucket/key.txt', 'bucket/key.txt')).toBe(true);
  });

  it('treats different names, parents and case on posix providers as different', () => {
    expect(isSamePathOnProvider('sftp', '/data/a.txt', '/data/b.txt')).toBe(false);
    expect(isSamePathOnProvider('sftp', '/data/a.txt', '/other/a.txt')).toBe(false);
    expect(isSamePathOnProvider('s3', 'bucket/Key.txt', 'bucket/key.txt')).toBe(false);
  });

  it('resolves local paths', () => {
    expect(isSamePathOnProvider('local', '/tmp/x/../a.txt', '/tmp/a.txt')).toBe(true);
    expect(isSamePathOnProvider('local', '/tmp/a.txt', '/tmp/b.txt')).toBe(false);
  });
});
