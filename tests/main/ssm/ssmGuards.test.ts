import { describe, it, expect } from 'vitest';
import { sshRoutingChanged } from '../../../src/main/services/teamVaultSecretGuards';
import { buildManagedSshConfigBlockFromProfiles } from '../../../src/main/services/SshNativeFileMerger';
import type { SSHConnectionConfig } from '../../../src/shared/types/ssh';

const p = (over: Partial<SSHConnectionConfig> = {}): SSHConnectionConfig =>
  ({ id: 'a', name: 'web', host: 'example.com', port: 22, username: 'u', authType: 'agent', ...over }) as SSHConnectionConfig;

describe('SSM guards', () => {
  it('treats ssm changes as routing changes (team vault)', () => {
    const base = p({ host: 'i-0123456789abcdef0', ssm: { enabled: true, region: 'eu-north-1' } });
    expect(sshRoutingChanged({ ...base }, base)).toBe(false);
    expect(sshRoutingChanged({ ...base, ssm: { enabled: true, region: 'us-east-1' } }, base)).toBe(true);
    expect(sshRoutingChanged({ ...base, ssm: { enabled: true, awsProfile: 'other' } }, base)).toBe(true);
    expect(sshRoutingChanged({ ...base, ssm: undefined }, base)).toBe(true);
  });
  it('compares ssm field-wise, independent of key order and undefined keys', () => {
    const a = p({ ssm: { enabled: true, region: 'eu-north-1' } });
    const b = p({ ssm: { region: 'eu-north-1', awsProfile: undefined, enabled: true } as never });
    expect(sshRoutingChanged(a, b)).toBe(false);
  });
  it('does not export SSM profiles to the native ssh config', () => {
    const block = buildManagedSshConfigBlockFromProfiles(
      [p(), p({ id: 'b', name: 'cloud', host: 'i-0123456789abcdef0', ssm: { enabled: true } })],
      null,
    );
    expect(block.body).toContain('example.com');
    expect(block.body).not.toContain('i-0123456789abcdef0');
  });
});
