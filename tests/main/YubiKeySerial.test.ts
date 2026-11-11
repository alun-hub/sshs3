import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  buildKeyComment,
  listConnectedYubiKeySerials,
  parseYkmanList,
  parseYubiKeySerialTag,
  readKeyYubiKeySerial,
} from '../../src/main/smartcard/YubiKeySerial';

const BLOB = 'AAAA';

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

describe('parseYkmanList', () => {
  it('reads the serial of every device line of `ykman list`, tolerating CRLF and blank lines', () => {
    expect(parseYkmanList('YubiKey 5 NFC (5.4.3) [OTP+FIDO+CCID] Serial: 20185052\r\nYubiKey 5C (5.2.4) [OTP+FIDO+CCID] Serial: 7015986\r\n\r\n')).toEqual([
      '20185052',
      '7015986',
    ]);
  });

  it('is an empty list when no device is listed', () => {
    expect(parseYkmanList('')).toEqual([]);
    expect(parseYkmanList('\r\n')).toEqual([]);
  });

  it('is unknown (undefined) when any listed device has no readable serial', () => {
    expect(parseYkmanList('Security Key NFC (5.4.3) [FIDO]\n')).toBeUndefined();
    expect(parseYkmanList('YubiKey 5 NFC (5.4.3) [OTP+FIDO+CCID] Serial: 20185052\nSecurity Key NFC (5.4.3) [FIDO]\n')).toBeUndefined();
  });
});

describe('listConnectedYubiKeySerials', () => {
  it.skipIf(process.platform === 'win32')('is unknown (undefined) outside Windows, so nothing is ever blocked there', async () => {
    await expect(listConnectedYubiKeySerials()).resolves.toBeUndefined();
  });
});
