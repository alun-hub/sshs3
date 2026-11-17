import { describe, it, expect, vi, beforeEach } from 'vitest';

const pages: Array<{ InstanceInformationList: Array<Record<string, unknown>> }> = [];
vi.mock('@aws-sdk/client-ssm', () => ({
  SSMClient: class { destroy() {} },
  paginateDescribeInstanceInformation: async function* () { for (const p of pages) yield p; },
}));
vi.mock('@aws-sdk/credential-provider-sso', () => ({ fromSSO: () => async () => ({}) }));
vi.mock('../../../src/main/aws/buildAwsNodeHttpHandler', () => ({ buildAwsNodeHttpHandler: () => ({}) }));

import { discoverInstances, describeDiscoveryError } from '../../../src/main/aws/AwsSsmDiscoveryService';
import { registerAwsSsmHandlers } from '../../../src/main/ipc/awsSsmHandlers';
import { IPC_CHANNELS } from '../../../src/shared/types/ipc';

const SSO = { startUrl: 'https://d-1.awsapps.com/start', region: 'eu-north-1', accountId: '123456789012', roleName: 'Admin' };
const rec = (n: number) => ({ InstanceId: `i-${n.toString(16).padStart(17, '0')}`, ComputerName: `h${n}` });

beforeEach(() => { pages.length = 0; });

describe('discoverInstances', () => {
  it('merges pages and maps records', async () => {
    pages.push({ InstanceInformationList: [rec(1), rec(2)] }, { InstanceInformationList: [rec(3), { InstanceId: 'bad' }] });
    const r = await discoverInstances({ sso: SSO, region: 'eu-north-1' });
    expect(r.instances.map((i) => i.name)).toEqual(['h1', 'h2', 'h3']);
    expect(r.truncated).toBe(false);
  });
  it('truncates at the cap', async () => {
    pages.push({ InstanceInformationList: Array.from({ length: 501 }, (_, i) => rec(i + 1)) });
    const r = await discoverInstances({ sso: SSO, region: 'eu-north-1' });
    expect(r.instances).toHaveLength(500);
    expect(r.truncated).toBe(true);
  });
  it('requires account, role and a valid region', async () => {
    await expect(discoverInstances({ sso: { ...SSO, roleName: undefined }, region: 'eu-north-1' })).rejects.toThrow(/account and role/);
    await expect(discoverInstances({ sso: SSO, region: 'bad;region' })).rejects.toThrow(/region/);
  });
});

describe('describeDiscoveryError', () => {
  it('keeps SSO expiry and access denied distinguishable', () => {
    expect(describeDiscoveryError(Object.assign(new Error('x'), { name: 'TokenProviderError' }))).toMatch(/^AWS SSO session expired/);
    expect(describeDiscoveryError(Object.assign(new Error('x'), { name: 'AccessDeniedException' }))).toMatch(/Access denied/);
    expect(describeDiscoveryError(new Error('boom'))).toBe('boom');
  });
});

describe('aws-ssm:discover-instances handler', () => {
  const handlers = new Map<string, (...a: unknown[]) => Promise<unknown>>();
  const bridge = {
    registerHandler: (c: string, h: (...a: unknown[]) => Promise<unknown>) => { handlers.set(c, h); },
    policy: { policy: { settings: {}, features: {} } },
    awsSsoAuthService: { getTokenStatus: vi.fn().mockResolvedValue('valid') },
  } as never;
  registerAwsSsmHandlers(bridge);
  const call = (req: unknown) => handlers.get(IPC_CHANNELS.AWS_SSM_DISCOVER_INSTANCES)!({}, req);

  it('validates arguments in main', async () => {
    await expect(call(undefined)).rejects.toThrow(/Invalid/);
    await expect(call({ sso: { ...SSO, startUrl: 'http://x' }, region: 'eu-north-1' })).rejects.toThrow(/Invalid/);
    await expect(call({ sso: SSO, region: 'x y' })).rejects.toThrow(/Invalid/);
  });
  it('returns instances for a valid, signed-in request', async () => {
    pages.push({ InstanceInformationList: [rec(1)] });
    await expect(call({ sso: SSO, region: 'eu-north-1' })).resolves.toMatchObject({ instances: [{ name: 'h1' }] });
  });
  it('is refused by policy', async () => {
    const off = { ...(bridge as object), policy: { policy: { settings: {}, features: { awsSsm: false } } } } as never;
    const h2 = new Map<string, (...a: unknown[]) => Promise<unknown>>();
    registerAwsSsmHandlers({ ...(off as object), registerHandler: (c: string, h: (...a: unknown[]) => Promise<unknown>) => { h2.set(c, h); } } as never);
    await expect(h2.get(IPC_CHANNELS.AWS_SSM_DISCOVER_INSTANCES)!({}, { sso: SSO, region: 'eu-north-1' })).rejects.toThrow(/disabled by your administrator/);
    registerAwsSsmHandlers(bridge); // restore the allowed state for later tests
  });
});
