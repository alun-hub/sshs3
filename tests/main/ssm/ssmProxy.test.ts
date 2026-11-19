import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildSsmProxyCommand, buildSsmEnv, assertValidSsm, setSsmAllowed, networkEnvFor, buildSsmShellSpawn, isSsmShell, SSM_SHELL_NO_SSH_MESSAGE } from '../../../src/main/ssh/ssmProxy';
import { buildSsoConfigFile, ensureSsoConfigFile, ssoProfileName } from '../../../src/main/aws/ssoConfigFile';
import { candidateDirs, findExecutable, pathDirs, pluginStatusFromVersion, toolDirsMissingFromPath } from '../../../src/main/aws/AwsSsmToolchain';
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
  it('uses the instance region (not the SSO home region) and the given profile name', () => {
    expect(buildSsmProxyCommand({ enabled: true, region: 'eu-west-1', sso: SSO }, 'linux', 'sshs3-abc')).toContain('--region eu-west-1 --profile sshs3-abc');
    expect(buildSsmProxyCommand({ enabled: true, sso: SSO }, 'linux', 'sshs3-abc')).not.toContain('--region');
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
    expect(env.AWS_CONFIG_FILE).toBeUndefined(); // user's own config location is kept in profile mode
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
      expect(path.normalize(findExecutable(['/nonexistent', d], 'aws', 'linux')!)).toBe(path.join(d, 'aws'));
      expect(findExecutable([d], 'nope', 'linux')).toBeUndefined();
    } finally { fs.rmSync(d, { recursive: true, force: true }); }
    expect(pluginStatusFromVersion('1.1.9.0')).toBe(false);
    expect(pluginStatusFromVersion('1.2.707.0')).toBe(true);
    expect(pluginStatusFromVersion(undefined)).toBeUndefined();
  });
});

describe('buildSsmEnv PATH handling', () => {
  it('does not re-add directories that are already on PATH', () => {
    expect(buildSsmEnv({ enabled: true }, ['/usr/bin', '/opt/aws/bin'], { PATH: '/bin:/usr/bin' }, 'linux')).toEqual({ PATH: '/opt/aws/bin:/bin:/usr/bin' });
  });
});

describe('toolDirsMissingFromPath', () => {
  it('adds nothing for tools PATH already resolves, so an earlier aws on PATH keeps priority', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ssm-pp-'));
    try {
      fs.writeFileSync(path.join(d, 'aws'), '');
      fs.writeFileSync(path.join(d, 'session-manager-plugin'), '');
      expect(toolDirsMissingFromPath('linux', { PATH: d }, '/nonexistent')).toEqual([]);
    } finally { fs.rmSync(d, { recursive: true, force: true }); }
  });
});

describe('review fixes', () => {
  it('keeps the user config location in awsProfile mode but replaces it for sso', () => {
    const base = { AWS_CONFIG_FILE: '/work/aws/config', AWS_SHARED_CREDENTIALS_FILE: '/work/aws/creds' };
    expect(buildSsmEnv({ enabled: true, awsProfile: 'prod' }, [], base, 'linux')).not.toHaveProperty('AWS_CONFIG_FILE');
    const sso = buildSsmEnv({ enabled: true, sso: SSO }, [], base, 'linux', '/app/x.config');
    expect(sso.AWS_CONFIG_FILE).toBe('/app/x.config');
    expect(sso.AWS_SHARED_CREDENTIALS_FILE).toBe('');
  });
  it('emits each Windows env name once, in the casing already present', () => {
    const env = buildSsmEnv({ enabled: true, sso: SSO }, [], { Aws_Config_File: 'C:\\old', Aws_Access_Key_Id: 'k' }, 'win32', 'C:\\app\\x.config');
    expect(Object.keys(env).filter((k) => k.toUpperCase() === 'AWS_CONFIG_FILE')).toEqual(['Aws_Config_File']);
    expect(env.Aws_Config_File).toBe('C:\\app\\x.config');
    expect(Object.keys(env).filter((k) => k.toUpperCase() === 'AWS_ACCESS_KEY_ID')).toEqual(['Aws_Access_Key_Id']);
  });
  it('refuses every spawn path when the awsSsm policy is off', () => {
    setSsmAllowed(false);
    try {
      expect(() => SmartcardDetector.buildSSHArguments(base())).toThrow(/disabled by your administrator/);
    } finally { setSsmAllowed(true); }
    expect(() => SmartcardDetector.buildSSHArguments(base())).not.toThrow();
  });
});

describe('AWS network settings in the ssh environment', () => {
  it('exports proxy and CA bundle to the aws CLI, for every SSM credential source', async () => {
    const { setAwsNetworkSettings } = await import('../../../src/main/aws/awsNetworkSettings');
    setAwsNetworkSettings({ httpsProxy: 'http://proxy.corp:3128', customCaPath: '/etc/corp-ca.pem' });
    try {
      for (const ssm of [{ enabled: true as const }, { enabled: true as const, awsProfile: 'p' }]) {
        const env = SmartcardDetector.buildProxyEnv(base({ ssm }));
        expect(env.HTTPS_PROXY).toBe('http://proxy.corp:3128');
        expect(env.AWS_CA_BUNDLE).toBe('/etc/corp-ca.pem');
      }
      setAwsNetworkSettings({ httpsProxy: 'http://user:secret@proxy.corp:3128' }); // pragma: allowlist secret
      expect(SmartcardDetector.buildProxyEnv(base())).not.toHaveProperty('HTTPS_PROXY'); // credentials never go into the environment
    } finally { setAwsNetworkSettings(undefined); }
    expect(SmartcardDetector.buildProxyEnv(base())).not.toHaveProperty('HTTPS_PROXY');
  });
});

describe('networkEnvFor casing', () => {
  const net = { httpsProxy: 'http://proxy.corp:3128', customCaPath: '/etc/corp-ca.pem' };
  it('sets both spellings on POSIX so an ambient lower-case variable cannot win', () => {
    expect(networkEnvFor(net, { https_proxy: 'http://old:1' }, 'linux')).toEqual({ HTTPS_PROXY: 'http://proxy.corp:3128', https_proxy: 'http://proxy.corp:3128', AWS_CA_BUNDLE: '/etc/corp-ca.pem' });
  });
  it('reuses the spelling already in the Windows environment so there is one entry', () => {
    expect(networkEnvFor(net, { Https_Proxy: 'http://old:1' }, 'win32')).toEqual({ Https_Proxy: 'http://proxy.corp:3128', AWS_CA_BUNDLE: '/etc/corp-ca.pem' });
    expect(networkEnvFor(net, {}, 'win32')).toEqual({ HTTPS_PROXY: 'http://proxy.corp:3128', AWS_CA_BUNDLE: '/etc/corp-ca.pem' });
  });
  it('adds nothing without a proxy', () => {
    expect(networkEnvFor({ customCaPath: '/ca.pem' }, {}, 'linux')).toEqual({ AWS_CA_BUNDLE: '/ca.pem' });
    expect(networkEnvFor(undefined, {}, 'win32')).toEqual({});
  });
});

describe('Session Manager shell mode', () => {
  const shell = (ssm: NonNullable<SSHConnectionConfig['ssm']>, over: Partial<SSHConnectionConfig> = {}) => base({ ssm: { mode: 'shell', ...ssm }, ...over });

  it('is recognised only for enabled SSM profiles with mode shell', () => {
    expect(isSsmShell(shell({ enabled: true }))).toBe(true);
    expect(isSsmShell(base())).toBe(false);
    expect(isSsmShell(base({ ssm: { enabled: true, mode: 'ssh' } }))).toBe(false);
    expect(isSsmShell(base({ ssm: undefined }))).toBe(false);
  });

  it('builds the aws command for each credential source with validated arguments only', () => {
    const def = buildSsmShellSpawn(shell({ enabled: true }));
    expect(def.args).toEqual(['ssm', 'start-session', '--target', ID]);
    expect(buildSsmShellSpawn(shell({ enabled: true, region: 'eu-north-1', awsProfile: 'prod' })).args).toEqual(['ssm', 'start-session', '--target', ID, '--region', 'eu-north-1', '--profile', 'prod']);
    const sso = buildSsmShellSpawn(shell({ enabled: true, region: 'eu-north-1', sso: SSO }));
    expect(sso.args.slice(0, 4)).toEqual(['ssm', 'start-session', '--target', ID]);
    expect(sso.args).toContain('--profile');
    expect(sso.args[sso.args.indexOf('--profile') + 1]).toMatch(/^sshs3-[0-9a-f]{12}$/);
    expect(sso.env.AWS_CONFIG_FILE).toMatch(/\.config$/); // the app-owned config for the sign-in
    expect(sso.env.TERM).toBe('xterm-256color');
    expect(sso.env.AWS_ACCESS_KEY_ID).toBe(''); // ambient keys are cleared when sshs3 chose the source
  });

  it('adds the AWS network settings to the environment and the caller env on top', async () => {
    const { setAwsNetworkSettings } = await import('../../../src/main/aws/awsNetworkSettings');
    setAwsNetworkSettings({ httpsProxy: 'http://proxy.corp:3128' });
    try {
      const spawn = buildSsmShellSpawn(shell({ enabled: true }), { EXTRA: '1' });
      expect(spawn.env.HTTPS_PROXY).toBe('http://proxy.corp:3128');
      expect(spawn.env.EXTRA).toBe('1');
    } finally { setAwsNetworkSettings(undefined); }
  });

  it('refuses hostile or incomplete settings and the policy switch', () => {
    expect(() => buildSsmShellSpawn(base())).toThrow(/does not use a Session Manager shell/);
    expect(() => buildSsmShellSpawn(shell({ enabled: true }, { host: 'example.com; rm -rf /' }))).toThrow(/Instance ID/);
    expect(() => buildSsmShellSpawn(shell({ enabled: true, awsProfile: '$(id)' }))).toThrow(/profile/);
    expect(() => buildSsmShellSpawn(shell({ enabled: true, mode: 'weird' as never }))).toThrow();
    setSsmAllowed(false);
    try { expect(() => buildSsmShellSpawn(shell({ enabled: true }))).toThrow(/disabled by your administrator/); } finally { setSsmAllowed(true); }
  });

  it('keeps every ssh-based feature from silently using a shell profile', () => {
    expect(() => SmartcardDetector.buildSSHArguments(shell({ enabled: true }))).toThrow(SSM_SHELL_NO_SSH_MESSAGE);
  });
});

describe('ssmReconnectBlocked', () => {
  it('blocks an automatic reconnect only for an SSM profile whose own SSO sign-in has lapsed', async () => {
    const { ssmReconnectBlocked, setSsoSignedInCheck } = await import('../../../src/main/ssh/ssmProxy');
    const sso = { enabled: true as const, region: 'eu-north-1', sso: { startUrl: 'https://d-1.awsapps.com/start', region: 'us-east-1' } };
    setSsoSignedInCheck(async () => false);
    expect(await ssmReconnectBlocked({ ssm: sso })).toBe(true);
    expect(await ssmReconnectBlocked({ ssm: { enabled: true as const, awsProfile: 'p' } })).toBe(false);
    expect(await ssmReconnectBlocked({})).toBe(false);
    setSsoSignedInCheck(async () => true);
    expect(await ssmReconnectBlocked({ ssm: sso })).toBe(false);
  });
});
