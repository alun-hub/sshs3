import { describe, it, expect, vi, beforeEach } from 'vitest';

// Data the mocked SSM paginator returns, keyed `${targetTag}|${region}`; an Error value makes that search fail.
const data = new Map<string, Array<Record<string, unknown>> | Error>();
const ec2 = { names: new Map<string, string>(), denied: false, calls: 0 };
const live = { active: 0, max: 0, destroyed: 0, hang: false, waiters: [] as Array<() => void> };

vi.mock('@aws-sdk/client-ssm', () => ({
  SSMClient: class {
    config: { region: string; credentials: { tag: string } };
    constructor(cfg: { region: string; credentials: { tag: string } }) { this.config = cfg; }
    destroy() { live.destroyed++; live.waiters.splice(0).forEach((f) => f()); }
  },
  paginateDescribeInstanceInformation: async function* ({ client }: { client: { config: { region: string; credentials: { tag: string } } } }) {
    live.active++; live.max = Math.max(live.max, live.active);
    try {
      if (live.hang) await new Promise<void>((_, reject) => { live.waiters.push(() => reject(new Error('socket closed'))); });
      await new Promise((r) => setTimeout(r, 5));
      const entry = data.get(`${client.config.credentials.tag}|${client.config.region}`) ?? [];
      if (entry instanceof Error) throw entry;
      yield { InstanceInformationList: entry };
    } finally { live.active--; }
  },
}));
vi.mock('@aws-sdk/client-ec2', () => ({
  EC2Client: class { destroy() {} async send() {
    ec2.calls++;
    if (ec2.denied) throw Object.assign(new Error('nope'), { name: 'UnauthorizedOperation' });
    return { Reservations: [{ Instances: [...ec2.names].map(([id, name]) => ({ InstanceId: id, Tags: [{ Key: 'Name', Value: name }] })) }] };
  } },
  DescribeInstancesCommand: class { constructor(public input: unknown) {} },
}));
vi.mock('../../../src/main/aws/buildAwsNodeHttpHandler', () => ({ buildAwsNodeHttpHandler: () => ({}) }));

import { scanInstances, classifyScanError } from '../../../src/main/aws/awsScanService';
import type { AwsScanTarget } from '../../../src/shared/types/awsScan';

const id = (n: number) => `i-${n.toString(16).padStart(17, '0')}`;
const rec = (n: number, extra: Record<string, unknown> = {}) => ({ InstanceId: id(n), ComputerName: `host${n}`, PlatformType: 'Linux', PlatformName: 'Amazon Linux', PingStatus: 'Online', ...extra });
const target = (tag: string, extra: Partial<AwsScanTarget> = {}): AwsScanTarget => ({
  id: tag, label: tag, accountId: '123456789012', accountName: `acct-${tag}`, source: { kind: 'default' }, ...extra,
});
const credentialsFor = (t: AwsScanTarget) => Object.assign(async () => ({ accessKeyId: 'x', secretAccessKey: 'y' }), { tag: t.id }) as never;

beforeEach(() => { live.hang = false; live.destroyed = 0; live.waiters = []; data.clear(); ec2.names.clear(); ec2.denied = false; ec2.calls = 0; live.active = 0; live.max = 0; });

describe('scanInstances', () => {
  it('merges accounts and regions, tags each instance with its origin and reports progress', async () => {
    data.set('a|eu-north-1', [rec(1), rec(2)]);
    data.set('a|us-east-1', [rec(3)]);
    data.set('b|eu-north-1', [rec(4)]);
    const progress: number[] = [];
    const r = await scanInstances({ targets: [target('a'), target('b')], regions: ['eu-north-1', 'us-east-1'] }, { credentialsFor, onProgress: (p) => progress.push(p.done), includeNames: false });
    expect(r.instances.map((i) => [i.targetId, i.region, i.instanceId])).toEqual(expect.arrayContaining([
      ['a', 'eu-north-1', id(1)], ['a', 'eu-north-1', id(2)], ['a', 'us-east-1', id(3)], ['b', 'eu-north-1', id(4)],
    ]));
    expect(r.instances).toHaveLength(4);
    expect(r.instances[0]).toMatchObject({ accountName: expect.stringContaining('acct-'), accountId: '123456789012' });
    expect(r.searched).toBe(4);
    expect(r.skipped).toEqual([]);
    expect(progress.at(-1)).toBe(4);
  });

  it('skips failing searches instead of failing the scan and classifies them', async () => {
    data.set('a|eu-north-1', [rec(1)]);
    data.set('a|us-west-1', Object.assign(new Error('denied'), { name: 'AccessDeniedException' }));
    data.set('a|ap-south-1', Object.assign(new Error('bad token'), { name: 'UnrecognizedClientException' }));
    data.set('a|eu-west-1', Object.assign(new Error('Token has expired'), { name: 'TokenProviderError' }));
    const r = await scanInstances({ targets: [target('a')], regions: ['eu-north-1', 'us-west-1', 'ap-south-1', 'eu-west-1'] }, { credentialsFor, includeNames: false });
    expect(r.instances).toHaveLength(1);
    expect(r.skipped.map((s) => [s.region, s.reason]).sort()).toEqual([['ap-south-1', 'region-disabled'], ['eu-west-1', 'expired'], ['us-west-1', 'access-denied']]);
    expect(r.searched).toBe(4);
  });

  it('never runs more searches at once than the concurrency limit', async () => {
    const regions = ['us-east-1', 'us-east-2', 'us-west-1', 'us-west-2', 'eu-west-1', 'eu-west-2', 'eu-north-1', 'eu-central-1'];
    await scanInstances({ targets: [target('a')], regions }, { credentialsFor, concurrency: 3, includeNames: false });
    expect(live.max).toBeLessThanOrEqual(3);
    expect(live.max).toBeGreaterThan(1);
  });

  it('stops starting new searches once aborted', async () => {
    const ac = new AbortController();
    const regions = ['us-east-1', 'us-east-2', 'us-west-1', 'us-west-2', 'eu-west-1'];
    const r = await scanInstances({ targets: [target('a')], regions }, { credentialsFor, concurrency: 1, includeNames: false, signal: ac.signal, onProgress: () => ac.abort() });
    expect(r.searched).toBeLessThan(regions.length);
  });

  it('ends requests that are still in flight when cancelled, without reporting them as failures', async () => {
    live.hang = true; // a region that never answers
    const ac = new AbortController();
    const running = scanInstances({ targets: [target('a')], regions: ['us-east-1', 'eu-west-1'] }, { credentialsFor, includeNames: false, signal: ac.signal, concurrency: 2 });
    await new Promise((r) => setTimeout(r, 20));
    ac.abort();
    const r = await Promise.race([running, new Promise<'timeout'>((res) => setTimeout(() => res('timeout'), 1000))]);
    expect(r).not.toBe('timeout');
    expect((r as { skipped: unknown[] }).skipped).toEqual([]);
    expect(live.destroyed).toBeGreaterThanOrEqual(2);
  });

  it('hides Windows nodes unless asked, and caps the result', async () => {
    data.set('a|eu-north-1', [rec(1), rec(2, { PlatformType: 'Windows' })]);
    expect((await scanInstances({ targets: [target('a')], regions: ['eu-north-1'] }, { credentialsFor, includeNames: false })).instances).toHaveLength(1);
    expect((await scanInstances({ targets: [target('a')], regions: ['eu-north-1'], includeWindows: true }, { credentialsFor, includeNames: false })).instances).toHaveLength(2);
    data.set('a|eu-north-1', Array.from({ length: 600 }, (_, i) => rec(i + 1)));
    const big = await scanInstances({ targets: [target('a')], regions: ['eu-north-1'] }, { credentialsFor, includeNames: false });
    expect(big.instances).toHaveLength(500);
    expect(big.truncated).toBe(true);
  });

  it('uses EC2 Name tags when allowed and falls back (once per target) when denied', async () => {
    data.set('a|eu-north-1', [rec(1)]);
    data.set('a|us-east-1', [rec(2)]);
    ec2.names.set(id(1), 'api-prod-1');
    const ok = await scanInstances({ targets: [target('a')], regions: ['eu-north-1'] }, { credentialsFor });
    expect(ok.instances[0].name).toBe('api-prod-1');
    ec2.denied = true; ec2.calls = 0;
    const denied = await scanInstances({ targets: [target('a')], regions: ['eu-north-1', 'us-east-1'] }, { credentialsFor, concurrency: 1 });
    expect(denied.instances.map((i) => i.name).sort()).toEqual(['host1', 'host2']);
    expect(ec2.calls).toBe(1); // not asked again for the same target after the denial
  });

  it('validates the request', async () => {
    await expect(scanInstances({ targets: [], regions: ['eu-north-1'] }, { credentialsFor })).rejects.toThrow(/at least one/);
    await expect(scanInstances({ targets: [target('a')], regions: ['bad region'] }, { credentialsFor })).rejects.toThrow(/Invalid AWS region/);
    const many = Array.from({ length: 30 }, (_, i) => target(`t${i}`));
    const regions = ['us-east-1', 'us-east-2', 'us-west-1', 'us-west-2', 'eu-west-1', 'eu-west-2', 'eu-north-1', 'eu-central-1', 'ca-central-1', 'sa-east-1', 'ap-south-1', 'ap-northeast-1', 'ap-northeast-2', 'ap-southeast-1']; // 30*14 = 420 > 400
    await expect(scanInstances({ targets: many, regions }, { credentialsFor })).rejects.toThrow(/Too many searches/);
  });

  it('records a target whose credentials cannot be built as skipped', async () => {
    const bad = target('bad', { source: { kind: 'profile', name: 'x; rm -rf /' } });
    const r = await scanInstances({ targets: [bad], regions: ['eu-north-1'] }, { includeNames: false });
    expect(r.instances).toEqual([]);
    expect(r.skipped[0]).toMatchObject({ targetId: 'bad', reason: 'error' });
    expect(r.skipped[0].message).toMatch(/Invalid AWS CLI profile/);
  });
});

describe('classifyScanError', () => {
  it('maps DNS failures and unknown errors', () => {
    expect(classifyScanError(Object.assign(new Error('x'), { code: 'ENOTFOUND' })).reason).toBe('region-disabled');
    expect(classifyScanError(new Error('boom'))).toEqual({ reason: 'error', message: 'boom' });
    expect(classifyScanError(Object.assign(new Error('Could not load credentials'), { name: 'CredentialsProviderError' })).reason).toBe('credentials');
  });
});
