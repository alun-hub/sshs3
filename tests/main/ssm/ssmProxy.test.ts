import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildSsmProxyCommand, buildSsmEnv, assertValidSsm } from '../../../src/main/ssh/ssmProxy';
import { buildSsoConfigFile, ensureSsoConfigFile, ssoProfileName } from '../../../src/main/aws/ssoConfigFile';
import { candidateDirs, findExecutable, pathDirs, pluginStatusFromVersion } from '../../../src/main/aws/AwsSsmToolchain';
import { SmartcardDetector } from '../../../src/main/smartcard/SmartcardDetector';
import type { SSHConnectionConfig } from '../../../src/shared/types/ssh';

const ID = 'i-0123456789abcdef0';
const SSO = { startUrl: 'https://d-123.awsapps.com/start', region: 'eu-north-1', accountId: '123456789012', roleName: 'Admin' };
const base = (over: Partial<SSHConnectionConfig> = {}): SSHConnectionConfig =>
  ({ id: 'x', name: 'n', host: ID, port: 22, username: 'ec2-user', authType: 'agent', ssm: { enabled: true }, ...over }) as SSHConnectionConfig;

describe('buildSsmProxyCommand', () => {
  it('matches the AWS-documented Linux form', () => {
    expect(buildSsmProxyCommand({ enabled: true }, 'linux')).toBe(
      `sh -c "aws ssm start-session --target %h --document-name AWS-StartSSHSession --parameters 'portNumber=%p'"`,
    );
  });
  it('matches the AWS-documented Windows form and appends region/profile', () => {
    expect(buildSsmProxyCommand({ enabled: true, region: 'eu-north-1', awsProfile: 'prod' }, 'win32')).toBe(
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe "aws ssm start-session --target %h --document-name AWS-StartSSHSession --parameters portNumber=%p --region eu-north-1 --profile prod"',
    );
  });
  it('uses the sso region and given profile name', () => {
    expect(buildSsmProxyCommand({ enabled: true, sso: SSO }, 'linux', 'sshs3-abc')).toContain('--region eu-north-1 --profile sshs3-abc');
  });
});

describe('assertValidSsm / buildSSHArguments', () => {
  it('rejects bad instance ids, proxies and jump hosts', () => {
    expect(() => assertValidSsm(base({ host: 'example.com' }))).toThrow(/Instance ID/);
    expect(() => assertValidSsm(base({ proxyJump: 'a@b' }))).toThrow(/jump host/);
    expect(() => assertValidSsm(base({ proxy: { enabled: true, type: 'http', host: 'p', port: 1 } }))).toThrow(/jump host or an outgoing proxy/);
    expect(() => assertValidSsm(base({ ssm: { enabled: true, region: 'x;id' } }))).toThrow(/region/);
    expect(() => assertValidSsm(base())).not.toThrow();
    expect(() => assertValidSsm(base({ ssm: undefined }))).not.toThrow();
  });
  it('emits the ProxyCommand and ignores extraOptions ProxyCommand', () => {
    const args = SmartcardDetector.buildSSHArguments(base({ extraOptions: { ProxyCommand: 'touch /tmp/x' } }));
    const opts = args.filter((_, i) => args[i - 1] === '-o');
    expect(opts.filter((o) => o.startsWith('ProxyCommand='))).toHaveLength(1);
    expect(opts.join('\n')).not.toContain('touch');
    expect(args.at(-1)).toBe(`ec2-user@${ID}`);
  });
  it('throws through buildSSHArguments for hostile hosts', () => {
    expect(() => SmartcardDetector.buildSSHArguments(base({ host: 'i-0123456789abcdef0;id' }))).toThrow();
  });
  const sshG = (() => { try { execFileSync('ssh', ['-V'], { stdio: 'ignore' }); return true; } catch { return false; } })();
  it.skipIf(!sshG)('is parsed by ssh -G with %h/%p intact', () => {
    const args = SmartcardDetector.buildSSHArguments(base({ ssm: { enabled: true, region: 'eu-north-1', awsProfile: 'prod' } }));
    const out = execFileSync('ssh', ['-G', ...args], { encoding: 'utf8' });
    const line = out.split('\n').find((l) => l.startsWith('proxycommand '));
    expect(line).toContain('start-session --target %h');
    expect(line).toContain('portNumber=%p');
    expect(line).toContain('--profile prod');
  });
});

describe('buildSsmEnv', () => {
  it('does not touch the env in default-chain mode, except PATH', () => {
    const env = buildSsmEnv({ enabled: true }, [], { AWS_ACCESS_KEY_ID: 'k' }, 'linux');
    expect(env).toEqual({});
  });
  it('scrubs credential vars when sshs3 chose the source and preserves Path casing', () => {
    const env = buildSsmEnv({ enabled: true, awsProfile: 'p' }, ['C:\\Program Files\\Amazon\\AWSCLIV2'], { Path: 'C:\\Windows', AWS_SECRET_ACCESS_KEY: 's' }, 'win32');
    expect(env.AWS_SECRET_ACCESS_KEY).toBe('');
    expect(env.Path).toBe('C:\\Program Files\\Amazon\\AWSCLIV2;C:\\Windows');
    expect(env.PATH).toBeUndefined();
    expect(env.AWS_PROFILE).toBeUndefined();
  });
  it('sets AWS_CONFIG_FILE for sso', () => {
    expect(buildSsmEnv({ enabled: true, sso: SSO }, [], {}, 'linux', '/x/y.config').AWS_CONFIG_FILE).toBe('/x/y.config');
  });
  it('ignores relative tool dirs', () => {
    expect(buildSsmEnv({ enabled: true }, ['bin', '../x'], { PATH: '/usr/bin' }, 'linux')).toEqual({});
  });
});

describe('ssoConfigFile', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ssm-cfg-')); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('writes a legacy sso profile with 0600 and is idempotent', () => {
    const f = ensureSsoConfigFile(SSO, dir);
    expect(fs.readFileSync(f, 'utf8')).toBe(buildSsoConfigFile(SSO));
    expect(buildSsoConfigFile(SSO)).toContain(`[profile ${ssoProfileName(SSO)}]`);
    if (process.platform !== 'win32') expect(fs.statSync(f).mode & 0o777).toBe(0o600);
    expect(ensureSsoConfigFile(SSO, dir)).toBe(f);
  });
  it('refuses injection payloads', () => {
    for (const roleName of ['A\ncredential_process = touch x', 'A]\n[profile y', 'a b', 'a\rb']) {
      expect(() => buildSsoConfigFile({ ...SSO, roleName })).toThrow();
    }
    expect(() => buildSsoConfigFile({ ...SSO, startUrl: 'https://x.com/s\ncredential_process=id' })).toThrow();
    expect(() => buildSsoConfigFile({ ...SSO, accountId: undefined })).toThrow(/account and role/);
  });
  it('replaces a symlink instead of following it', () => {
    if (process.platform === 'win32') return;
    const target = path.join(dir, 'victim');
    fs.writeFileSync(target, 'keep');
    fs.mkdirSync(path.join(dir, 'aws'));
    fs.symlinkSync(target, path.join(dir, 'aws', `${ssoProfileName(SSO)}.config`));
    ensureSsoConfigFile(SSO, dir);
    expect(fs.readFileSync(target, 'utf8')).toBe('keep');
  });
});

describe('toolchain helpers', () => {
  it('lists Windows and Linux candidate dirs', () => {
    expect(candidateDirs('win32', { ProgramFiles: 'C:\\Program Files' }, 'C:\\Users\\u').plugin[0]).toBe('C:\\Program Files\\Amazon\\SessionManagerPlugin\\bin');
    expect(candidateDirs('linux', {}, '/home/u').aws).toContain('/home/u/.local/bin');
  });
  it('reads PATH case-insensitively', () => {
    expect(pathDirs({ Path: 'C:\\a;C:\\b' }, 'win32')).toEqual(['C:\\a', 'C:\\b']);
    expect(pathDirs({}, 'linux')).toEqual([]);
  });
  it('finds executables by fs check and flags old plugins', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ssm-tc-'));
    try {
      fs.writeFileSync(path.join(d, 'aws'), '');
      expect(findExecutable(['/nonexistent', d], 'aws', 'linux')).toBe(path.join(d, 'aws'));
      expect(findExecutable([d], 'nope', 'linux')).toBeUndefined();
    } finally { fs.rmSync(d, { recursive: true, force: true }); }
    expect(pluginStatusFromVersion('1.1.9.0')).toBe(false);
    expect(pluginStatusFromVersion('1.2.707.0')).toBe(true);
    expect(pluginStatusFromVersion(undefined)).toBeUndefined();
  });
});
