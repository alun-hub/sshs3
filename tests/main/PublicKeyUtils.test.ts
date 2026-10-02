import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  parsePublicKeyLine,
  parsePublicKeyLines,
  buildInstallCommand,
  parseInstallOutput,
  isPrivateKeyEncrypted,
  parseProbeOutput,
  chooseLoginOrder,
  REMOTE_INSTALL_COMMAND,
} from '../../src/main/ssh/PublicKeyUtils';

/** Giltig ed25519-blob: längdprefixad "ssh-ed25519" + 32 nollbytes (längd 32). */
function ed25519Blob(fill: number): string {
  const type = Buffer.from('ssh-ed25519');
  const len = (n: number) => {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(n);
    return b;
  };
  return Buffer.concat([len(type.length), type, len(32), Buffer.alloc(32, fill)]).toString('base64');
}

const KEY_A = `ssh-ed25519 ${ed25519Blob(1)} alice@laptop`;
const KEY_B = `ssh-ed25519 ${ed25519Blob(2)}`;

describe('parsePublicKeyLine', () => {
  it('parses type, comment and a SHA256 fingerprint', () => {
    const p = parsePublicKeyLine(KEY_A);
    expect(p).toMatchObject({ type: 'ssh-ed25519', comment: 'alice@laptop' });
    expect(p?.fingerprint).toMatch(/^SHA256:[A-Za-z0-9+/]{43}$/);
  });

  it('accepts a key without comment', () => {
    expect(parsePublicKeyLine(KEY_B)?.comment).toBe('');
  });

  it.each([
    ['empty', ''],
    ['garbage', 'hello world'],
    ['options prefix', `command="rm -rf /" ${KEY_A}`],
    ['certificate type', KEY_A.replace('ssh-ed25519', 'ssh-ed25519-cert-v01@openssh.com')],
    ['embedded newline', `${KEY_A}\nssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAAAgQ`],
    ['type not matching blob', KEY_A.replace('ssh-ed25519', 'ssh-rsa')],
    ['control character in comment', `${KEY_A}\u0007`],
    ['non-ASCII comment', `${KEY_B} kommentär`],
  ])('rejects %s', (_name, line) => {
    expect(parsePublicKeyLine(line)).toBeNull();
  });
});

describe('parsePublicKeyLines', () => {
  it('skips blanks, comments and invalid lines', () => {
    const out = parsePublicKeyLines(`# c\n\n${KEY_A}\nnope\r\n${KEY_B}\n`);
    expect(out).toHaveLength(2);
  });
});

describe('buildInstallCommand', () => {
  it('produces a short, readable, idempotent script with one line per key', () => {
    const lines = buildInstallCommand([KEY_A, KEY_B]).split('\n');
    expect(lines[0]).toMatch(/^# Adds 2 public keys to ~\/\.ssh\/authorized_keys/);
    expect(lines).toHaveLength(5);
    expect(lines[3]).toContain(`echo '${KEY_A}' >> ~/.ssh/authorized_keys`);
    expect(lines[3]).toMatch(/^grep -qF '[A-Za-z0-9+/=]+' ~\/\.ssh\/authorized_keys \|\| echo /);
    expect(lines[4]).toContain(KEY_B);
  });

  it('uses singular wording for one key', () => {
    expect(buildInstallCommand([KEY_A])).toContain('Adds 1 public key to');
  });

  it('escapes single quotes in comments', () => {
    expect(buildInstallCommand([`${KEY_B} it's`])).toContain(`'${KEY_B} it'\\''s'`);
  });

  it('throws on invalid or empty input', () => {
    expect(() => buildInstallCommand(['nope'])).toThrow();
    expect(() => buildInstallCommand([])).toThrow();
  });

  it.skipIf(process.platform === 'win32')('works when executed by a real sh, twice, without duplicating', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 's3m-cmd-'));
    try {
      const cmd = buildInstallCommand([KEY_A, KEY_B]);
      fs.mkdirSync(path.join(home, '.ssh'));
      fs.writeFileSync(path.join(home, '.ssh', 'authorized_keys'), 'ssh-rsa EXISTING-NO-NEWLINE');
      for (let i = 0; i < 2; i++) execSync(cmd, { env: { ...process.env, HOME: home }, shell: '/bin/sh' });
      const lines = fs.readFileSync(path.join(home, '.ssh', 'authorized_keys'), 'utf8').trim().split('\n');
      expect(lines).toEqual(['ssh-rsa EXISTING-NO-NEWLINE', KEY_A, KEY_B]);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});

describe('REMOTE_INSTALL_COMMAND', () => {
  it('stays free of single quotes (it is wrapped in sh -c)', () => {
    const inner = REMOTE_INSTALL_COMMAND.slice("sh -c '".length, -1);
    expect(inner).not.toContain("'");
  });
});

describe('parseInstallOutput', () => {
  it('maps 1-based indexes to statuses and ignores other output', () => {
    const m = parseInstallOutput('banner\nS3M:1:installed\nS3M:2:present\nS3M:3:bogus\n');
    expect([...m]).toEqual([
      [1, 'installed'],
      [2, 'present'],
    ]);
  });
});

describe('isPrivateKeyEncrypted', () => {
  function openSshKey(cipher: string): string {
    const magic = Buffer.from('openssh-key-v1\0', 'latin1');
    const len = Buffer.alloc(4);
    len.writeUInt32BE(cipher.length);
    const body = Buffer.concat([magic, len, Buffer.from(cipher), Buffer.alloc(16)]).toString('base64');
    return `-----BEGIN OPENSSH PRIVATE KEY-----\n${body}\n-----END OPENSSH PRIVATE KEY-----\n`;
  }

  it('detects unencrypted and encrypted OpenSSH keys', () => {
    expect(isPrivateKeyEncrypted(openSshKey('none'))).toBe(false);
    expect(isPrivateKeyEncrypted(openSshKey('aes256-ctr'))).toBe(true);
  });

  it('detects encrypted PEM and treats unknown formats as encrypted', () => {
    expect(isPrivateKeyEncrypted('-----BEGIN RSA PRIVATE KEY-----\nProc-Type: 4,ENCRYPTED\n')).toBe(true);
    expect(isPrivateKeyEncrypted('-----BEGIN RSA PRIVATE KEY-----\nMIIE\n-----END RSA PRIVATE KEY-----')).toBe(false);
    expect(isPrivateKeyEncrypted('whatever')).toBe(true);
  });
});

describe.skipIf(process.platform === 'win32')('remote install script (real sh)', () => {
  it('installs idempotently, creates ~/.ssh with safe modes and fixes a missing trailing newline', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 's3m-keyinstall-'));
    try {
      fs.mkdirSync(path.join(home, '.ssh'));
      fs.writeFileSync(path.join(home, '.ssh', 'authorized_keys'), 'ssh-rsa EXISTING-NO-NEWLINE');
      const run = () =>
        execSync(REMOTE_INSTALL_COMMAND, { input: `${KEY_A}\n${KEY_B}\n`, env: { ...process.env, HOME: home } }).toString();

      expect([...parseInstallOutput(run())]).toEqual([
        [1, 'installed'],
        [2, 'installed'],
      ]);
      expect([...parseInstallOutput(run())]).toEqual([
        [1, 'present'],
        [2, 'present'],
      ]);

      const file = path.join(home, '.ssh', 'authorized_keys');
      const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
      expect(lines).toEqual(['ssh-rsa EXISTING-NO-NEWLINE', KEY_A, KEY_B]);
      expect(fs.statSync(file).mode & 0o777).toBe(0o600);
      expect(fs.statSync(path.join(home, '.ssh')).mode & 0o777).toBe(0o700);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});

describe('parseProbeOutput', () => {
  it('reads the allowed methods from a permission-denied reply', () => {
    expect(parseProbeOutput('alice@h: Permission denied (publickey,password,keyboard-interactive).\n', 255)).toEqual({
      reachable: true,
      methods: ['publickey', 'password', 'keyboard-interactive'],
      hostKeyChanged: false,
    });
  });

  it('treats exit 0 as reachable with no authentication needed', () => {
    expect(parseProbeOutput('', 0)).toMatchObject({ reachable: true, methods: ['none'] });
  });

  it.each([
    ['ssh: Could not resolve hostname nope: Name or service not known', 'dns'],
    ['ssh: connect to host h port 22: Connection refused', 'refused'],
    ['ssh: connect to host h port 22: Connection timed out', 'timeout'],
    ['ssh: connect to host h port 22: No route to host', 'unreachable'],
    ['Connection closed by UNKNOWN port 65535', 'closed'],
    ['kex_exchange_identification: Connection closed by remote host', 'closed'],
    ['Host key verification failed.', 'hostkey-rejected'],
    ['something odd', 'unknown'],
  ])('classifies %j as %s', (stderr, kind) => {
    const p = parseProbeOutput(stderr, 255);
    expect(p.errorKind).toBe(kind);
    expect(p.methods).toEqual([]);
    expect(p.error).toBeTruthy();
  });

  it('flags a changed host key distinctly (and never as merely unreachable)', () => {
    const p = parseProbeOutput('@@@ WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED! @@@\nHost key verification failed.', 255);
    expect(p).toMatchObject({ hostKeyChanged: true, errorKind: 'hostkey-changed', reachable: true });
  });

  it('counts a rejected host key as reachable (the host answered)', () => {
    expect(parseProbeOutput('Host key verification failed.', 255).reachable).toBe(true);
  });
});

describe('chooseLoginOrder', () => {
  const both = ['publickey', 'password'];
  it('password profiles always log in with the password', () => {
    expect(chooseLoginOrder({ authType: 'password' })).toEqual(['password']);
    expect(chooseLoginOrder({ authType: 'password', installsOwnKeyOnly: true, serverMethods: ['publickey'] })).toEqual(['password']);
  });

  it.each(['privateKey', 'agent', 'smartcard', 'fido2'] as const)('%s: other keys -> profile login first, then password', (authType) => {
    expect(chooseLoginOrder({ authType, serverMethods: both })).toEqual(['profile', 'password']);
    expect(chooseLoginOrder({ authType })).toEqual(['profile', 'password']);
  });

  it.each(['privateKey', 'agent', 'smartcard', 'fido2'] as const)('%s: installing only its own key -> password, never the key itself', (authType) => {
    expect(chooseLoginOrder({ authType, installsOwnKeyOnly: true, serverMethods: both })).toEqual(['password']);
    expect(chooseLoginOrder({ authType, installsOwnKeyOnly: true })).toEqual(['password']);
    expect(chooseLoginOrder({ authType, installsOwnKeyOnly: true, serverMethods: ['password'] })).toEqual(['password']);
    expect(chooseLoginOrder({ authType, installsOwnKeyOnly: true, serverMethods: ['keyboard-interactive'] })).toEqual(['password']);
  });

  it('a keys-only server leaves nothing sensible when only the own key is selected', () => {
    expect(chooseLoginOrder({ authType: 'smartcard', installsOwnKeyOnly: true, serverMethods: ['publickey'] })).toEqual([]);
  });

  it('a keys-only server skips the password attempt for other keys', () => {
    expect(chooseLoginOrder({ authType: 'fido2', serverMethods: ['publickey'] })).toEqual(['profile']);
  });

  it('an explicit choice always wins', () => {
    expect(chooseLoginOrder({ authType: 'smartcard', loginMethod: 'password', installsOwnKeyOnly: false })).toEqual(['password']);
    expect(chooseLoginOrder({ authType: 'smartcard', loginMethod: 'profile', installsOwnKeyOnly: true, serverMethods: ['publickey'] })).toEqual(['profile']);
  });
});

describe('chooseLoginOrder with a smartcard library left in the profile (e.g. switched PIV -> FIDO2)', () => {
  const both = ['publickey', 'password'];

  it('own-key-only installs try the card first, then the password', () => {
    expect(chooseLoginOrder({ authType: 'fido2', installsOwnKeyOnly: true, hasSmartcardLib: true, serverMethods: both })).toEqual([
      'smartcard',
      'password',
    ]);
    expect(chooseLoginOrder({ authType: 'privateKey', installsOwnKeyOnly: true, hasSmartcardLib: true })).toEqual(['smartcard', 'password']);
  });

  it('other-key installs try the profile, then the card, then the password', () => {
    expect(chooseLoginOrder({ authType: 'fido2', hasSmartcardLib: true })).toEqual(['profile', 'smartcard', 'password']);
  });

  it('a keys-only server still allows the card when only the own key is selected', () => {
    expect(chooseLoginOrder({ authType: 'fido2', installsOwnKeyOnly: true, hasSmartcardLib: true, serverMethods: ['publickey'] })).toEqual(['smartcard']);
  });

  it('a smartcard profile never lists the card twice, and password profiles ignore a stale library', () => {
    expect(chooseLoginOrder({ authType: 'smartcard', hasSmartcardLib: true })).toEqual(['profile', 'password']);
    expect(chooseLoginOrder({ authType: 'password', hasSmartcardLib: true })).toEqual(['password']);
  });

  it('explicit choices (including smartcard and agent) are used as-is', () => {
    expect(chooseLoginOrder({ authType: 'fido2', loginMethod: 'smartcard', installsOwnKeyOnly: true })).toEqual(['smartcard']);
    expect(chooseLoginOrder({ authType: 'fido2', loginMethod: 'agent' })).toEqual(['agent']);
  });
});
