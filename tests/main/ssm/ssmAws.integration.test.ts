import { describe, it, expect } from 'vitest';
import { discoverInstances } from '../../../src/main/aws/AwsSsmDiscoveryService';
import { AwsSsoAuthService } from '../../../src/main/aws/AwsSsoAuthService';
import { scanInstances } from '../../../src/main/aws/awsScanService';
import { suggestLoginName } from '../../../src/shared/ssm';

/**
 * Opt-in, needs a real AWS account: run the real discovery code against it with temporary credentials from the
 * environment (e.g. `eval "$(aws configure export-credentials --profile P --format env)"`), plus
 * SSHS3_AWS_TEST_INSTANCE=<instance id of an SSM-managed node> and SSHS3_AWS_TEST_REGION=<region>.
 */
const instance = process.env.SSHS3_AWS_TEST_INSTANCE;
const region = process.env.SSHS3_AWS_TEST_REGION ?? 'eu-north-1';
const SSO = { startUrl: 'https://d-1.awsapps.com/start', region, accountId: '123456789012', roleName: 'Unused' };

describe.skipIf(!instance)('discoverInstances against real AWS', () => {
  it('lists the SSM-managed node with sanitised fields and a sensible login suggestion', async () => {
    const r = await discoverInstances({ sso: SSO, region }, {}, {
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
        sessionToken: process.env.AWS_SESSION_TOKEN,
      },
    });
    const found = r.instances.find((i) => i.instanceId === instance);
    expect(found).toBeDefined();
    expect(found).toMatchObject({ platformType: 'Linux', pingStatus: 'Online' });
    expect(found!.ipAddress).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
    expect(found!.name.length).toBeGreaterThan(0);
    expect(suggestLoginName(found!.platformName)).toBe('ec2-user');
  });
});

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SmartcardDetector } from '../../../src/main/smartcard/SmartcardDetector';
import type { SSHConnectionConfig } from '../../../src/shared/types/ssh';

/**
 * Opt-in end-to-end: ssh through a real SSM session using the app's own argument/env builders.
 * Needs the aws CLI + session-manager-plugin, SSHS3_AWS_TEST_INSTANCE, SSHS3_AWS_TEST_KEY (private key path),
 * SSHS3_AWS_TEST_PROFILE (an AWS CLI profile) and optionally SSHS3_AWS_TEST_USER (default ec2-user).
 */
const key = process.env.SSHS3_AWS_TEST_KEY;
const profile = process.env.SSHS3_AWS_TEST_PROFILE;

function sshThroughSsm(ssm: SSHConnectionConfig['ssm'], env: NodeJS.ProcessEnv = process.env) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ssm-e2e-'));
  try {
    const config = {
      id: 'e2e', name: 'e2e', host: instance!, port: 22, username: process.env.SSHS3_AWS_TEST_USER ?? 'ec2-user',
      authType: 'privateKey', privateKeyPath: key, ssm,
    } as SSHConnectionConfig;
    const args = SmartcardDetector.buildSSHArguments(config);
    const opts = ['-F', '/dev/null', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new', '-o', `UserKnownHostsFile=${dir}/kh`, '-o', 'ConnectTimeout=60', '-o', 'IdentitiesOnly=yes'];
    return spawnSync('ssh', [...opts, ...args, 'echo sshs3-ok; uname -m; systemctl is-active sshd'], {
      env: { ...env, ...SmartcardDetector.buildProxyEnv(config) },
      encoding: 'utf8',
      timeout: 120_000,
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe.skipIf(!instance || !key || !profile)('ssh through a real SSM session', () => {
  it('connects with an AWS CLI profile', () => {
    const r = sshThroughSsm({ enabled: true, region, awsProfile: profile });
    expect(r.stderr + r.stdout).toContain('sshs3-ok');
    expect(r.stdout).toContain('aarch64');
    expect(r.stdout).toContain('active');
  }, 150_000);

  it('connects with the default credential chain (AWS_PROFILE in the environment)', () => {
    const r = sshThroughSsm({ enabled: true, region }, { ...process.env, AWS_PROFILE: profile });
    expect(r.stdout).toContain('sshs3-ok');
  }, 150_000);
});

/**
 * Opt-in, interactive: the real IAM Identity Center flow. Needs SSHS3_AWS_TEST_SSO_URL (start/issuer URL),
 * SSHS3_AWS_TEST_SSO_REGION (Identity Center region), SSHS3_AWS_TEST_ACCOUNT, SSHS3_AWS_TEST_ROLE, plus the ssh
 * variables above. The device-authorization prompt is written to SSHS3_AWS_TEST_PROMPT_FILE for a human to approve.
 */
const ssoUrl = process.env.SSHS3_AWS_TEST_SSO_URL;

describe.skipIf(!ssoUrl || !instance || !key)('IAM Identity Center sign-in through sshs3', () => {
  it('signs in, lists account/role, discovers the node and ssh-es through SSM with the app-owned config', async () => {
    const ssoRegion = process.env.SSHS3_AWS_TEST_SSO_REGION ?? 'us-east-1';
    const accountId = process.env.SSHS3_AWS_TEST_ACCOUNT!;
    const roleName = process.env.SSHS3_AWS_TEST_ROLE!;
    const svc = new AwsSsoAuthService();

    const login = await svc.login(ssoUrl!, ssoRegion, {
      onPrompt: (prompt) => {
        if (process.env.SSHS3_AWS_TEST_PROMPT_FILE) fs.writeFileSync(process.env.SSHS3_AWS_TEST_PROMPT_FILE, JSON.stringify(prompt));
      },
    });
    expect(login.accessToken.length).toBeGreaterThan(10);
    expect(await svc.getTokenStatus(ssoUrl!)).toBe('valid');

    const accounts = await svc.listAccounts(login.accessToken, ssoRegion);
    expect(accounts.map((a) => a.accountId)).toContain(accountId);
    const roles = await svc.listAccountRoles(login.accessToken, ssoRegion, accountId);
    expect(roles.map((r) => r.roleName)).toContain(roleName);

    const sso = { startUrl: ssoUrl!, region: ssoRegion, accountId, roleName };
    // fromSSO + the token cache the sign-in just wrote
    const found = await discoverInstances({ sso, region });
    expect(found.instances.map((i) => i.instanceId)).toContain(instance);

    // AWS CLI v2 reading the app-owned legacy SSO profile with the shared token cache, via the real ProxyCommand
    const r = sshThroughSsm({ enabled: true, region, sso });
    expect(r.stdout).toContain('sshs3-ok');
  }, 600_000);
});

/**
 * Opt-in: the multi-region scan against real AWS with an AWS CLI profile (SDK provider chain, e.g. an `aws login`
 * profile) and with the default chain (AWS_PROFILE in the environment). Needs SSHS3_AWS_TEST_PROFILE,
 * SSHS3_AWS_TEST_INSTANCE, SSHS3_AWS_TEST_REGION and optionally SSHS3_AWS_TEST_NAME (expected EC2 Name tag).
 */
describe.skipIf(!instance || !profile)('multi-region scan against real AWS', () => {
  const regions = [region, 'us-east-1', 'eu-west-1'];
  const expectedName = process.env.SSHS3_AWS_TEST_NAME;

  it('finds the node through an AWS CLI profile, uses the Name tag and skips nothing it can reach', async () => {
    const r = await scanInstances({ targets: [{ id: 'p', label: profile!, source: { kind: 'profile', name: profile! } }], regions });
    const found = r.instances.find((i) => i.instanceId === instance);
    expect(found).toBeDefined();
    expect(found!.region).toBe(region);
    if (expectedName) expect(found!.name).toBe(expectedName);
    expect(r.searched).toBe(regions.length);
  }, 120_000);

  it('finds the node through the default credential chain', async () => {
    const before = process.env.AWS_PROFILE;
    process.env.AWS_PROFILE = profile;
    try {
      const r = await scanInstances({ targets: [{ id: 'd', label: 'default', source: { kind: 'default' } }], regions: [region] }, { includeNames: false });
      expect(r.instances.map((i) => i.instanceId)).toContain(instance);
    } finally {
      if (before === undefined) delete process.env.AWS_PROFILE; else process.env.AWS_PROFILE = before;
    }
  }, 120_000);
});
