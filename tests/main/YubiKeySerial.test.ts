import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  buildKeyComment,
  listConnectedYubiKeySerials,
  parseSerialList,
  parseYubiKeySerialTag,
  readKeyYubiKeySerial,
} from '../../src/main/smartcard/YubiKeySerial';

const BLOB = 'AAAAGnNrLXNzaC1lZDI1NTE5QG9wZW5zc2guY29t';

describe('parseYubiKeySerialTag', () => {
  it('reads the serial from the comment of a public key line', () => {
    expect(parseYubiKeySerialTag(`sk-ssh-ed25519@openssh.com ${BLOB} alun@Elitebook yubikey:20185052\n`)).toBe('20185052');
    expect(parseYubiKeySerialTag(`sk-ssh-ed25519@openssh.com ${BLOB} yubikey:7015986`)).toBe('7015986');
  });

  it('finds the tag among other words of the comment', () => {
    expect(parseYubiKeySerialTag(`sk-ssh-ed25519@openssh.com ${BLOB} my key yubikey:7015986 work`)).toBe('7015986');
  });

  it('returns undefined without a tag, or when the tag is not a serial', () => {
    expect(parseYubiKeySerialTag(`sk-ssh-ed25519@openssh.com ${BLOB} alun@Elitebook`)).toBeUndefined();
    expect(parseYubiKeySerialTag(`sk-ssh-ed25519@openssh.com ${BLOB}`)).toBeUndefined();
    expect(parseYubiKeySerialTag(`sk-ssh-ed25519@openssh.com ${BLOB} yubikey:abc`)).toBeUndefined();
    expect(parseYubiKeySerialTag(`sk-ssh-ed25519@openssh.com ${BLOB} notyubikey:20185052`)).toBeUndefined();
  });

  it('only looks in the comment, never in the type or the key blob', () => {
    expect(parseYubiKeySerialTag('yubikey:20185052 yubikey:20185052')).toBeUndefined();
  });
});

describe('buildKeyComment', () => {
  it('is what ssh-keygen would use by default, plus the serial tag', () => {
    const comment = buildKeyComment('20185052');
    expect(comment).toMatch(/^.+@.+ yubikey:20185052$/);
    expect(parseYubiKeySerialTag(`sk-ssh-ed25519@openssh.com ${BLOB} ${comment}`)).toBe('20185052');
  });
});

describe('readKeyYubiKeySerial', () => {
  it('reads the tag from <key>.pub, and is undefined when the file or tag is missing', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sshs3-yk-'));
    try {
      const withTag = path.join(dir, 'id_ed25519_sk');
      await fs.writeFile(`${withTag}.pub`, `sk-ssh-ed25519@openssh.com ${BLOB} a@b yubikey:20185052\n`);
      const withoutTag = path.join(dir, 'id_other_sk');
      await fs.writeFile(`${withoutTag}.pub`, `sk-ssh-ed25519@openssh.com ${BLOB} a@b\n`);

      await expect(readKeyYubiKeySerial(withTag)).resolves.toBe('20185052');
      await expect(readKeyYubiKeySerial(withoutTag)).resolves.toBeUndefined();
      await expect(readKeyYubiKeySerial(path.join(dir, 'missing'))).resolves.toBeUndefined();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe('parseSerialList', () => {
  it('keeps the serial lines of `ykman list --serials`, tolerating CRLF and noise', () => {
    expect(parseSerialList('20185052\r\n7015986\r\n')).toEqual(['20185052', '7015986']);
    expect(parseSerialList('')).toEqual([]);
    expect(parseSerialList('WARNING: something\n20185052\n')).toEqual(['20185052']);
  });
});

describe('listConnectedYubiKeySerials', () => {
  it.skipIf(process.platform === 'win32')('is unknown (undefined) outside Windows, so nothing is ever blocked there', async () => {
    await expect(listConnectedYubiKeySerials()).resolves.toBeUndefined();
  });
});
