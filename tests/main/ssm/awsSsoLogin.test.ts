import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('electron', () => ({ shell: { openExternal: vi.fn(async () => {}) } }));

import { capProfileNetwork, networkForSavedS3Profile } from '../../../src/main/aws/ssoNetwork';
import { setAwsNetworkSettings } from '../../../src/main/aws/awsNetworkSettings';
import { registerAwsSsoHandlers } from '../../../src/main/ipc/awsSsoHandlers';
import { IPC_CHANNELS } from '../../../src/shared/types/ipc';

const URL_ = 'https://d-1.awsapps.com/start';
const PROXY = { enabled: true, type: 'http', host: 'saved.proxy', port: 3128 } as const;

beforeEach(() => setAwsNetworkSettings(undefined));

describe('capProfileNetwork', () => {
  it('uses the global network when the profile brings none', () => {
    const g = { customCaPath: '/g.pem' };
    expect(capProfileNetwork(undefined, g)).toBe(g);
    expect(capProfileNetwork({}, g)).toBe(g);
  });
  it('keeps a profile proxy/CA but never lets it switch TLS verification off', () => {
    expect(capProfileNetwork({ proxy: PROXY, customCaPath: '/p.pem', rejectUnauthorized: false }, { rejectUnauthorized: undefined })).toEqual({
      customCaPath: '/p.pem', rejectUnauthorized: undefined, proxy: PROXY,
    });
    expect(capProfileNetwork({ proxy: PROXY, rejectUnauthorized: false }, { rejectUnauthorized: true })?.rejectUnauthorized).toBe(true);
    expect(capProfileNetwork({ proxy: PROXY, rejectUnauthorized: true }, undefined)?.rejectUnauthorized).toBe(true);
  });
  it('merges field by field: what the profile does not set comes from the AWS settings', () => {
    const global = { customCaPath: '/corp-ca.pem', proxy: { enabled: true, type: 'http', host: 'corp.proxy', port: 8080 } as const };
    // a profile with only its own proxy still trusts the corporate CA of the settings page
    expect(capProfileNetwork({ proxy: PROXY }, global)).toEqual({ customCaPath: '/corp-ca.pem', proxy: PROXY, rejectUnauthorized: undefined });
    // a profile with only its own CA still uses the settings proxy
    expect(capProfileNetwork({ customCaPath: '/p.pem' }, global)).toEqual({ customCaPath: '/p.pem', proxy: global.proxy, rejectUnauthorized: undefined });
    // a profile that disables its proxy explicitly wins over the settings proxy
    expect(capProfileNetwork({ proxy: { ...PROXY, enabled: false } }, global)?.proxy?.enabled).toBe(false);
    // TLS: the profile can only be stricter than the settings, and inherits them when silent
    expect(capProfileNetwork({ proxy: PROXY }, { rejectUnauthorized: false })?.rejectUnauthorized).toBe(false);
    expect(capProfileNetwork({ proxy: PROXY, rejectUnauthorized: false }, { rejectUnauthorized: true })?.rejectUnauthorized).toBe(true);
  });
});

describe('networkForSavedS3Profile', () => {
  const store = { getProfiles: async () => ({ s3: [
    { id: 'ok', sso: { startUrl: URL_, region: 'us-east-1' }, proxy: PROXY, rejectUnauthorized: false },
    { id: 'other-url', sso: { startUrl: 'https://d-2.awsapps.com/start', region: 'us-east-1' }, proxy: PROXY },
  ] }) } as never;
  it('uses the saved profile bound to this start URL/region, with TLS capped', async () => {
    setAwsNetworkSettings({ httpsProxy: 'http://corp.proxy:8080' });
    const n = await networkForSavedS3Profile(store, 'ok', URL_, 'us-east-1');
    expect(n?.proxy?.host).toBe('saved.proxy');
    expect(n?.rejectUnauthorized).toBeUndefined(); // the global value, not the profile's false
  });
  it('falls back to the AWS settings for an unknown id, another start URL, another region or a non-string id', async () => {
    setAwsNetworkSettings({ httpsProxy: 'http://corp.proxy:8080' });
    for (const [id, url, region] of [['nope', URL_, 'us-east-1'], ['other-url', URL_, 'us-east-1'], ['ok', URL_, 'eu-west-1'], [{ proxy: 'x' }, URL_, 'us-east-1']] as const) {
      expect((await networkForSavedS3Profile(store, id, url, region))?.proxy?.host).toBe('corp.proxy');
    }
  });
});

describe('AWS_SSO_LOGIN / AWS_SSO_RELOGIN_PROVIDER handlers', () => {
  const handlers = new Map<string, (...a: unknown[]) => Promise<any>>();
  const login = vi.fn(async () => ({ accessToken: 'secret-token', expiresAt: '2099-01-01T00:00:00Z' }));
  const clearCache = vi.fn();
  const provider = { type: 's3', clearCache, config: { authMode: 'sso', region: 'us-east-1', sso: { startUrl: URL_, region: 'us-east-1' }, proxy: PROXY, rejectUnauthorized: false } };
  // Saved by the S3 form of v0.97.9 and earlier, which stored the start URL exactly as typed.
  const LEGACY_URL = `${URL_}#/`;
  const legacyProvider = { type: 's3', clearCache, config: { authMode: 'sso', region: 'us-east-1', sso: { startUrl: LEGACY_URL, region: 'us-east-1' } } };
  beforeEach(() => {
    handlers.clear(); login.mockClear(); clearCache.mockClear();
    registerAwsSsoHandlers({
      registerHandler: (c: string, h: (...a: unknown[]) => Promise<unknown>) => { handlers.set(c, h); },
      awsSsoAuthService: { login },
      pendingAwsSsoLogins: new Map(),
      sendToSender: vi.fn(),
      storageRegistry: { get: (id: string) => (id === 's3-1' ? provider : id === 's3-legacy' ? legacyProvider : undefined) },
      profileStore: { getProfiles: async () => ({ s3: [] }) },
    } as never);
  });
  const call = (c: string, ...a: unknown[]) => handlers.get(c)!({ sender: {} }, ...a);

  it('never returns the access token, and ignores an object passed where a network used to be', async () => {
    setAwsNetworkSettings({ httpsProxy: 'http://corp.proxy:8080' });
    const hostile = { proxy: { enabled: true, type: 'http', host: 'attacker.example', port: 8080 }, rejectUnauthorized: false };
    const r = await call(IPC_CHANNELS.AWS_SSO_LOGIN, URL_, 'us-east-1', hostile);
    expect(r).toEqual({ expiresAt: '2099-01-01T00:00:00Z' });
    const opts = (login.mock.calls[0] as unknown as [string, string, { network?: { proxy?: { host: string }; rejectUnauthorized?: boolean } }])[2];
    expect(opts.network?.proxy?.host).toBe('corp.proxy');
    expect(opts.network?.rejectUnauthorized).toBeUndefined();
  });

  it('rejects a malformed start URL or region before anything is sent', async () => {
    for (const [u, r] of [['http://d-1.awsapps.com/start', 'us-east-1'], ['https://evil.example/x y', 'us-east-1'], [URL_, 'us-east-1.evil.com'], [URL_, '../x'], ['not a url', 'us-east-1']]) {
      await expect(call(IPC_CHANNELS.AWS_SSO_LOGIN, u, r)).rejects.toThrow(/Invalid AWS SSO start URL or region/);
    }
    expect(login).not.toHaveBeenCalled();
  });

  it('signs in with the start URL exactly as the saved profile holds it, because the S3 provider reads the token cache by that same string', async () => {
    // The cache file is named sha1(startUrl). The S3 provider looks it up with the saved string (fromSSO), so a
    // profile saved as ".../start#/" must be signed in as ".../start#/": normalising here would write the token
    // under a name the provider never reads. Validation still uses the normalised form.
    await call(IPC_CHANNELS.AWS_SSO_RELOGIN_PROVIDER, 's3-legacy');
    expect(login).toHaveBeenCalledTimes(1);
    expect((login.mock.calls[0] as unknown as [string, string])[0]).toBe(LEGACY_URL);
  });

  it('relogin uses the saved provider proxy/CA but never weaker TLS than the AWS settings', async () => {
    setAwsNetworkSettings(undefined);
    await call(IPC_CHANNELS.AWS_SSO_RELOGIN_PROVIDER, 's3-1');
    const opts = (login.mock.calls[0] as unknown as [string, string, { network?: { proxy?: { host: string }; rejectUnauthorized?: boolean } }])[2];
    expect(opts.network?.proxy?.host).toBe('saved.proxy');
    expect(opts.network?.rejectUnauthorized).toBeUndefined(); // the provider's rejectUnauthorized:false is not honoured
    expect(clearCache).toHaveBeenCalled();
  });
});
