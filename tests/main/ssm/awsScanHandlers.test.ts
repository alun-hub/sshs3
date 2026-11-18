import { describe, it, expect, vi, beforeEach } from 'vitest';

const scan = vi.fn();
const profiles = vi.fn();
const provider = vi.fn();
const execFileMock = vi.fn();
vi.mock('../../../src/main/aws/awsScanService', () => ({ scanInstances: (...a: unknown[]) => scan(...a) }));
vi.mock('../../../src/main/aws/awsProfiles', () => ({ listAwsCliProfiles: () => profiles() }));
vi.mock('../../../src/main/aws/awsCredentials', () => ({ buildCredentialProvider: () => provider }));
vi.mock('../../../src/main/aws/AwsSsmToolchain', () => ({ locateTools: () => ({ aws: '/usr/bin/aws' }) }));
vi.mock('node:child_process', () => ({ execFile: (...a: unknown[]) => execFileMock(...a) }));

import { setAwsNetworkSettings } from '../../../src/main/aws/awsNetworkSettings';
import { registerAwsScanHandlers, describeProfileError } from '../../../src/main/ipc/awsScanHandlers';
import { IPC_CHANNELS } from '../../../src/shared/types/ipc';
import { validateScanRequest, normalizeScanRequest, isValidScanId } from '../../../src/shared/awsScan';

const SSO = { startUrl: 'https://d-1.awsapps.com/start', region: 'us-east-1', accountId: '123456789012', roleName: 'Dev' };
const goodRequest = () => ({
  targets: [{ id: 't1', label: 'prod', accountId: '123456789012', accountName: 'Prod', source: { kind: 'sso', sso: SSO } }],
  regions: ['eu-north-1'],
});

const handlers = new Map<string, (...a: unknown[]) => Promise<any>>();
const sent: unknown[][] = [];
let tokenStatus: 'valid' | 'expired' | 'missing' = 'valid';
let features: Record<string, boolean> = {};
const bridge = {
  registerHandler: (c: string, h: (...a: unknown[]) => Promise<unknown>) => { handlers.set(c, h); },
  sendToSender: (...a: unknown[]) => { sent.push(a); return true; },
  awsSsoAuthService: { getTokenStatus: async () => tokenStatus },
  get policy() { return { policy: { settings: {}, features } }; },
} as never;
registerAwsScanHandlers(bridge);
const call = (channel: string, ...args: unknown[]) => handlers.get(channel)!({ sender: { id: 1 } }, ...args);

beforeEach(() => { scan.mockReset(); profiles.mockReset(); provider.mockReset(); execFileMock.mockReset(); sent.length = 0; tokenStatus = 'valid'; features = {}; });

describe('validateScanRequest', () => {
  it('accepts a good request and rejects hostile ones', () => {
    expect(validateScanRequest(goodRequest())).toBeUndefined();
    const bad = (mut: (r: any) => void) => { const r = goodRequest() as any; mut(r); return validateScanRequest(r); };
    expect(bad((r) => { r.targets = []; })).toMatch(/at least one/);
    expect(bad((r) => { r.regions = ['us east']; })).toMatch(/region/);
    expect(bad((r) => { r.targets[0].id = 'bad id!'; })).toMatch(/id/);
    expect(bad((r) => { r.targets.push({ ...r.targets[0] }); })).toMatch(/id/); // duplicate
    expect(bad((r) => { r.targets[0].accountId = '12'; })).toMatch(/account id/);
    expect(bad((r) => { r.targets[0].source = { kind: 'profile', name: '$(id)' }; })).toMatch(/source/);
    expect(bad((r) => { r.targets[0].source = { kind: 'sso', sso: { ...SSO, roleName: undefined } }; })).toMatch(/source/);
    expect(bad((r) => { r.targets = Array.from({ length: 201 }, (_, i) => ({ ...r.targets[0], id: `t${i}` })); })).toMatch(/Too many/);
    expect(validateScanRequest(null)).toMatch(/Invalid/);
  });
  it('normalises to known fields and sanitises labels', () => {
    const r = goodRequest() as any;
    r.targets[0].label = 'pr‮od\n';
    r.targets[0].extra = 'ignored';
    r.targets[0].source.sso.extra = 'ignored';
    const n = normalizeScanRequest(r);
    expect(n.targets[0].label).not.toMatch(/[‮\n]/);
    expect(JSON.stringify(n)).not.toContain('ignored');
  });
  it('validates scan ids', () => {
    expect(isValidScanId('3f2b8c1e-aaaa-bbbb-cccc-1234567890ab')).toBe(true);
    expect(isValidScanId('short')).toBe(false);
    expect(isValidScanId('x'.repeat(100))).toBe(false);
  });
});

describe('aws-ssm:scan', () => {
  const ID = '3f2b8c1e-aaaa-bbbb-cccc-1234567890ab';

  it('runs the scan, forwards progress to the caller and cleans up', async () => {
    scan.mockImplementation(async (_req, opts) => { opts.onProgress({ done: 1, total: 2 }); return { instances: [], skipped: [], truncated: false, searched: 2 }; });
    const r = await call(IPC_CHANNELS.AWS_SSM_SCAN, { scanId: ID, request: goodRequest() });
    expect(r.searched).toBe(2);
    expect(sent[0][1]).toBe(IPC_CHANNELS.AWS_SSM_SCAN_PROGRESS);
    expect(sent[0][2]).toEqual({ scanId: ID, done: 1, total: 2 });
    // the same id can be reused after it finished
    await expect(call(IPC_CHANNELS.AWS_SSM_SCAN, { scanId: ID, request: goodRequest() })).resolves.toBeDefined();
  });

  it('searches with the AWS network settings', async () => {
    scan.mockResolvedValue({ instances: [], skipped: [], truncated: false, searched: 1 });
    setAwsNetworkSettings({ httpsProxy: 'http://proxy.corp:3128' });
    try {
      await call(IPC_CHANNELS.AWS_SSM_SCAN, { scanId: ID, request: goodRequest() });
      expect(scan.mock.calls[0][1].network).toMatchObject({ proxy: { host: 'proxy.corp', port: 3128 } });
    } finally { setAwsNetworkSettings(undefined); }
  });

  it('refuses invalid requests, expired sign-ins and a blocking policy', async () => {
    await expect(call(IPC_CHANNELS.AWS_SSM_SCAN, { scanId: 'x', request: goodRequest() })).rejects.toThrow(/Invalid scan request/);
    await expect(call(IPC_CHANNELS.AWS_SSM_SCAN, { scanId: ID, request: { targets: [], regions: [] } })).rejects.toThrow(/at least one/);
    tokenStatus = 'expired';
    await expect(call(IPC_CHANNELS.AWS_SSM_SCAN, { scanId: ID, request: goodRequest() })).rejects.toThrow(/^AWS SSO session expired/);
    tokenStatus = 'valid';
    features = { awsSsm: false };
    await expect(call(IPC_CHANNELS.AWS_SSM_SCAN, { scanId: ID, request: goodRequest() })).rejects.toThrow(/disabled by your administrator/);
    expect(scan).not.toHaveBeenCalled();
  });

  it('does not check the SSO cache for profile or default sources', async () => {
    tokenStatus = 'missing';
    scan.mockResolvedValue({ instances: [], skipped: [], truncated: false, searched: 1 });
    const req = { targets: [{ id: 'p', label: 'p', source: { kind: 'profile', name: 'corp' } }, { id: 'd', label: 'd', source: { kind: 'default' } }], regions: ['eu-north-1'] };
    await expect(call(IPC_CHANNELS.AWS_SSM_SCAN, { scanId: ID, request: req })).resolves.toBeDefined();
  });

  it('cancels a running scan and rejects a duplicate id', async () => {
    let signal: AbortSignal | undefined;
    let release!: () => void;
    scan.mockImplementation((_r, opts) => new Promise((resolve) => { signal = opts.signal; release = () => resolve({ instances: [], skipped: [], truncated: false, searched: 0 }); }));
    const running = call(IPC_CHANNELS.AWS_SSM_SCAN, { scanId: ID, request: goodRequest() });
    await new Promise((r) => setTimeout(r, 5));
    await expect(call(IPC_CHANNELS.AWS_SSM_SCAN, { scanId: ID, request: goodRequest() })).rejects.toThrow(/already running/);
    await call(IPC_CHANNELS.AWS_SSM_SCAN_CANCEL, ID);
    expect(signal?.aborted).toBe(true);
    release();
    await running;
    await call(IPC_CHANNELS.AWS_SSM_SCAN_CANCEL, 'garbage'); // ignored, never throws
  });
});

describe('aws profiles', () => {
  it('lists profiles and checks status without prompting', async () => {
    profiles.mockResolvedValue([{ name: 'corp', kind: 'sso' }, { name: 'keys', kind: 'keys' }]);
    expect(await call(IPC_CHANNELS.AWS_SSM_LIST_PROFILES)).toHaveLength(2);
    provider.mockResolvedValue({ expiration: new Date('2030-01-01T00:00:00Z') });
    expect(await call(IPC_CHANNELS.AWS_SSM_PROFILE_STATUS, 'keys')).toEqual({ ok: true, expiresAt: '2030-01-01T00:00:00.000Z' });
    provider.mockRejectedValue(new Error('MFA token code required'));
    const bad = await call(IPC_CHANNELS.AWS_SSM_PROFILE_STATUS, 'keys');
    expect(bad.ok).toBe(false);
    expect(bad.message).toContain('aws sts get-caller-identity --profile keys');
    await expect(call(IPC_CHANNELS.AWS_SSM_PROFILE_STATUS, 'not-in-config')).rejects.toThrow(/not in your AWS CLI configuration/);
    await expect(call(IPC_CHANNELS.AWS_SSM_PROFILE_STATUS, '$(id)')).rejects.toThrow(/Invalid AWS CLI profile/);
  });

  it('only signs in SSO profiles that exist, with fixed arguments and no shell', async () => {
    profiles.mockResolvedValue([{ name: 'corp', kind: 'sso' }, { name: 'keys', kind: 'keys' }]);
    execFileMock.mockImplementation((_f, _a, _o, cb) => cb(null));
    expect(await call(IPC_CHANNELS.AWS_SSM_PROFILE_LOGIN, 'corp')).toEqual({ ok: true });
    expect(execFileMock.mock.calls[0][0]).toBe('/usr/bin/aws');
    expect(execFileMock.mock.calls[0][1]).toEqual(['sso', 'login', '--profile', 'corp']);
    expect(execFileMock.mock.calls[0][2]).not.toHaveProperty('shell');
    await expect(call(IPC_CHANNELS.AWS_SSM_PROFILE_LOGIN, 'keys')).rejects.toThrow(/does not use AWS SSO/);
    await expect(call(IPC_CHANNELS.AWS_SSM_PROFILE_LOGIN, 'missing')).rejects.toThrow(/not in your AWS CLI/);
    execFileMock.mockImplementation((_f, _a, _o, cb) => cb(new Error('exit 1')));
    expect((await call(IPC_CHANNELS.AWS_SSM_PROFILE_LOGIN, 'corp')).ok).toBe(false);
  });

  it('turns SDK errors into advice', () => {
    expect(describeProfileError(new Error('The SSO session associated with this profile has expired'), 'p')).toMatch(/expired/);
    expect(describeProfileError(new Error('weird'), 'p')).toBe('weird');
  });
});
