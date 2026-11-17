import { describe, it, expect } from 'vitest';
import { toSftpConfig, SFTP_MAPPED_FIELDS, SFTP_FIELD_PARITY } from '../../src/shared/toSftpConfig';
import type { SSHConnectionConfig } from '../../src/shared/types/ssh';

// Every routing/auth field set to a distinct value: a field dropped from the mapping shows up as undefined.
const full: SSHConnectionConfig = {
  id: 'p1', name: 'n', host: 'h', port: 2200, username: 'u', authType: 'privateKey', password: 'pw',
  privateKeyPath: '/k', passphrase: 'pp', agentPath: '/a', pkcs11LibPath: '/lib', fido2Resident: true,
  initialPath: '/srv', proxy: { type: 'http', host: 'px', port: 1 }, proxyJump: 'j@h', proxyJumpProfileId: 'jp',
  ssm: { enabled: true, region: 'eu-north-1' },
};

describe('toSftpConfig', () => {
  it('maps every routing and auth field, including ssm', () => {
    const out = toSftpConfig(full) as unknown as Record<string, unknown>;
    for (const key of SFTP_MAPPED_FIELDS) expect(out[key], key).toEqual((full as unknown as Record<string, unknown>)[key]);
  });
  it('defaults the port and applies overrides', () => {
    expect(toSftpConfig({ ...full, port: undefined }).port).toBe(22);
    expect(toSftpConfig(full, { password: 'other' }).password).toBe('other');
  });
  it('has compile-time parity for fields shared by both types', () => {
    expect(SFTP_FIELD_PARITY).toBe(true);
  });
});
