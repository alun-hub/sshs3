import { describe, it, expect } from 'vitest';
import { isValidDragPayload } from '../../src/renderer/src/components/FileManager/types';

const validPayload = {
  fromPane: 'left',
  providerId: 'sftp-conn-1',
  basePath: '/home/user',
  entries: [{ name: 'file.txt', path: '/home/user/file.txt', size: 10, isDirectory: false }],
};

describe('isValidDragPayload (M6)', () => {
  it('accepts a well-formed payload', () => {
    expect(isValidDragPayload(validPayload)).toBe(true);
  });

  it('accepts a payload with zero entries', () => {
    expect(isValidDragPayload({ ...validPayload, entries: [] })).toBe(true);
  });

  it.each([null, undefined, 'a string', 42, []])('rejects non-object payload %p', (value) => {
    expect(isValidDragPayload(value)).toBe(false);
  });

  it('rejects a payload with an invalid fromPane', () => {
    expect(isValidDragPayload({ ...validPayload, fromPane: 'middle' })).toBe(false);
  });

  it('rejects a payload with a non-string providerId', () => {
    expect(isValidDragPayload({ ...validPayload, providerId: { injected: true } })).toBe(false);
  });

  it('rejects a payload with an empty providerId', () => {
    expect(isValidDragPayload({ ...validPayload, providerId: '' })).toBe(false);
  });

  it('rejects a payload whose entries is not an array', () => {
    expect(isValidDragPayload({ ...validPayload, entries: 'not-an-array' })).toBe(false);
  });

  it('rejects a payload with an entry missing a path', () => {
    expect(
      isValidDragPayload({
        ...validPayload,
        entries: [{ name: 'file.txt', size: 10, isDirectory: false }],
      })
    ).toBe(false);
  });

  it('rejects a payload with an entry whose path is not a string (e.g. an injected object)', () => {
    expect(
      isValidDragPayload({
        ...validPayload,
        entries: [{ name: 'file.txt', path: { toString: () => '/etc/passwd' }, size: 10, isDirectory: false }],
      })
    ).toBe(false);
  });

  it('rejects a payload with an entry whose isDirectory is not a boolean', () => {
    expect(
      isValidDragPayload({
        ...validPayload,
        entries: [{ name: 'file.txt', path: '/x', size: 10, isDirectory: 'false' }],
      })
    ).toBe(false);
  });
});
