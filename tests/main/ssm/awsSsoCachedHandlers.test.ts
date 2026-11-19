import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { AwsSsoAuthService } from '../../../src/main/aws/AwsSsoAuthService';
import { setAwsNetworkSettings } from '../../../src/main/aws/awsNetworkSettings';
import { registerAwsSsoCachedHandlers } from '../../../src/main/ipc/awsSsoCachedHandlers';
import { IPC_CHANNELS } from '../../../src/shared/types/ipc';

const URL_ = 'https://d-1.awsapps.com/start';
const TOKEN = 'super-secret-access-token-value';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sso-cache-'));
const svc = new AwsSsoAuthService({ ssoCacheDir: dir } as never);
const accounts = vi.spyOn(svc, 'listAccounts').mockResolvedValue([{ accountId: '123456789012', accountName: 'Prod' }]);
const roles = vi.spyOn(svc, 'listAccountRoles').mockResolvedValue([{ roleName: 'Dev' }]);

const handlers = new Map<string, (...a: unknown[]) => Promise<any>>();
let features: Record<string, boolean> = {};
registerAwsSsoCachedHandlers({
  registerHandler: (c: string, h: (...a: unknown[]) => Promise<unknown>) => { handlers.set(c, h); },
  awsSsoAuthService: svc,
  get policy() { return { policy: { settings: {}, features } }; },
  profileStore: { getProfiles: async () => ({ s3: [{ id: 's3-saved', sso: { startUrl: 'https://d-1.awsapps.com/start' }, proxy: { enabled: true, type: 'http', host: 'saved.proxy', port: 3128 }, rejectUnauthorized: true }, { id: 's3-plain' }, { id: 's3-other', sso: { startUrl: 'https://d-2.awsapps.com/start' }, rejectUnauthorized: false, proxy: { enabled: true, type: 'http', host: 'other.proxy', port: 1 } }] }) },
} as never);
const call = (c: string, ...a: unknown[]) => handlers.get(c)!({}, ...a);
const writeToken = (expiresAt: string) =>
  fs.writeFileSync(path.join(dir, `${crypto.createHash('sha1').update(URL_).digest('hex')}.json`), JSON.stringify({ accessToken: TOKEN, expiresAt }));

beforeEach(() => { features = {}; accounts.mockClear(); roles.mockClear(); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true }); });

describe('cached SSO handlers', () => {
  it('reports status and expiry but never the token', async () => {
    expect(await call(IPC_CHANNELS.AWS_SSO_STATUS, URL_)).toEqual({ status: 'missing' });
    writeToken(new Date(Date.now() + 3600_000).toISOString());
    const s = await call(IPC_CHANNELS.AWS_SSO_STATUS, URL_);
    expect(s.status).toBe('valid');
    expect(JSON.stringify(s)).not.toContain(TOKEN);
    writeToken(new Date(Date.now() - 1000).toISOString());
    expect((await call(IPC_CHANNELS.AWS_SSO_STATUS, URL_)).status).toBe('expired');
  });

  it('lists accounts and roles with the cached token, which is not part of any result', async () => {
    writeToken(new Date(Date.now() + 3600_000).toISOString());
    const a = await call(IPC_CHANNELS.AWS_SSO_LIST_ACCOUNTS_CACHED, { startUrl: URL_, region: 'us-east-1' });
    expect(accounts).toHaveBeenCalledWith(TOKEN, 'us-east-1', {});
    expect(JSON.stringify(a)).not.toContain(TOKEN);
    const r = await call(IPC_CHANNELS.AWS_SSO_LIST_ROLES_CACHED, { startUrl: URL_, region: 'us-east-1', accountId: '123456789012' });
    expect(roles).toHaveBeenCalledWith(TOKEN, 'us-east-1', '123456789012', {});
    expect(r).toEqual([{ roleName: 'Dev' }]);
  });

  it('always uses the AWS network settings: a renderer cannot choose the proxy or CA the token is sent through', async () => {
    writeToken(new Date(Date.now() + 3600_000).toISOString());
    setAwsNetworkSettings({ httpsProxy: 'http://proxy.corp:3128', customCaPath: '/etc/corp-ca.pem' });
    try {
      await call(IPC_CHANNELS.AWS_SSO_LIST_ACCOUNTS_CACHED, { startUrl: URL_, region: 'us-east-1' });
      expect(accounts).toHaveBeenLastCalledWith(TOKEN, 'us-east-1', expect.objectContaining({ customCaPath: '/etc/corp-ca.pem', proxy: expect.objectContaining({ host: 'proxy.corp', port: 3128 }) }));

      // A hostile request tries to send the token through its own proxy with TLS verification off.
      const hostile = { startUrl: URL_, region: 'us-east-1', accountId: '123456789012', network: { rejectUnauthorized: false, proxy: { enabled: true, type: 'http', host: 'attacker.example', port: 8080 } } };
      await call(IPC_CHANNELS.AWS_SSO_LIST_ACCOUNTS_CACHED, hostile);
      await call(IPC_CHANNELS.AWS_SSO_LIST_ROLES_CACHED, hostile);
      for (const fn of [accounts, roles]) {
        const network = fn.mock.calls.at(-1)!.at(-1) as { proxy?: { host: string }; rejectUnauthorized?: boolean };
        expect(network.proxy?.host).toBe('proxy.corp');
        expect(network.rejectUnauthorized).toBeUndefined();
        expect(JSON.stringify(fn.mock.calls.at(-1))).not.toContain('attacker.example');
      }
    } finally { setAwsNetworkSettings(undefined); }
  });

  it('asks for a sign-in when the token is missing or expired', async () => {
    await expect(call(IPC_CHANNELS.AWS_SSO_LIST_ACCOUNTS_CACHED, { startUrl: URL_, region: 'us-east-1' })).rejects.toThrow(/^AWS SSO session expired/);
    writeToken(new Date(Date.now() - 1000).toISOString());
    await expect(call(IPC_CHANNELS.AWS_SSO_LIST_ACCOUNTS_CACHED, { startUrl: URL_, region: 'us-east-1' })).rejects.toThrow(/^AWS SSO session expired/);
    expect(accounts).not.toHaveBeenCalled();
  });

  it('validates arguments in main and honours the policy', async () => {
    await expect(call(IPC_CHANNELS.AWS_SSO_STATUS, 'http://evil/../x')).rejects.toThrow(/Invalid AWS SSO start URL/);
    await expect(call(IPC_CHANNELS.AWS_SSO_LIST_ACCOUNTS_CACHED, { startUrl: URL_, region: 'bad;region' })).rejects.toThrow(/Invalid/);
    await expect(call(IPC_CHANNELS.AWS_SSO_LIST_ACCOUNTS_CACHED, undefined)).rejects.toThrow(/Invalid/);
    await expect(call(IPC_CHANNELS.AWS_SSO_LIST_ROLES_CACHED, { startUrl: URL_, region: 'us-east-1', accountId: '12' })).rejects.toThrow(/account id/);
    features = { awsSsm: false };
    await expect(call(IPC_CHANNELS.AWS_SSO_LIST_ACCOUNTS_CACHED, { startUrl: URL_, region: 'us-east-1' })).rejects.toThrow(/disabled by your administrator/);
  });

  it('uses the proxy of a SAVED S3 profile (looked up by id in main), falling back to the AWS settings', async () => {
    writeToken(new Date(Date.now() + 3600_000).toISOString());
    await call(IPC_CHANNELS.AWS_SSO_LIST_ACCOUNTS_CACHED, { startUrl: URL_, region: 'us-east-1', s3ProfileId: 's3-saved' });
    expect((accounts.mock.calls.at(-1)!.at(-1) as { proxy?: { host: string } }).proxy?.host).toBe('saved.proxy');
    for (const id of ['s3-plain', 'unknown', 's3-other']) { // 's3-other' belongs to another start URL: its proxy is not used
      setAwsNetworkSettings({ httpsProxy: 'http://proxy.corp:8080' });
      await call(IPC_CHANNELS.AWS_SSO_LIST_ACCOUNTS_CACHED, { startUrl: URL_, region: 'us-east-1', s3ProfileId: id });
      expect((accounts.mock.calls.at(-1)!.at(-1) as { proxy?: { host: string } }).proxy?.host).toBe('proxy.corp');
    }
    setAwsNetworkSettings(undefined);
  });
});
