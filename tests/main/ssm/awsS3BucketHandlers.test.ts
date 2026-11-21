import { describe, it, expect, vi, beforeEach } from 'vitest';

const listS3Buckets = vi.fn();
const s3BucketRegion = vi.fn();
vi.mock('../../../src/main/aws/awsS3Buckets', () => ({
  listS3Buckets: (...a: unknown[]) => listS3Buckets(...a),
  s3BucketRegion: (...a: unknown[]) => s3BucketRegion(...a),
}));

import { setAwsNetworkSettings } from '../../../src/main/aws/awsNetworkSettings';
import { registerAwsS3BucketHandlers } from '../../../src/main/ipc/awsS3BucketHandlers';
import { IPC_CHANNELS } from '../../../src/shared/types/ipc';

const URL_ = 'https://d-1.awsapps.com/start';
const REQ = { startUrl: URL_, region: 'us-east-1', accountId: '123456789012', roleName: 'Dev' };
const handlers = new Map<string, (...a: unknown[]) => Promise<any>>();
registerAwsS3BucketHandlers({
  registerHandler: (c: string, h: (...a: unknown[]) => Promise<unknown>) => { handlers.set(c, h); },
  profileStore: { getProfiles: async () => ({ s3: [{ id: 's3-saved', sso: { startUrl: URL_ }, proxy: { enabled: true, type: 'http', host: 'saved.proxy', port: 3128 }, rejectUnauthorized: true }] }) },
} as never);
const call = (c: string, ...a: unknown[]) => handlers.get(c)!({}, ...a);

beforeEach(() => { listS3Buckets.mockReset(); s3BucketRegion.mockReset(); setAwsNetworkSettings(undefined); });

describe('S3 bucket handlers', () => {
  it('lists the buckets for a validated sign-in, account and role', async () => {
    listS3Buckets.mockResolvedValue([{ name: 'a-bucket' }]);
    expect(await call(IPC_CHANNELS.AWS_S3_LIST_BUCKETS, REQ)).toEqual([{ name: 'a-bucket' }]);
    expect(listS3Buckets.mock.calls[0][0]).toEqual({ startUrl: URL_, region: 'us-east-1', accountId: '123456789012', roleName: 'Dev' });
  });

  it('refuses a request that is not a valid sign-in with an account and a role, before any AWS call', async () => {
    const bad = [
      undefined,
      { ...REQ, startUrl: 'http://d-1.awsapps.com/start' },
      { ...REQ, startUrl: 'https://evil.example/start;rm -rf' },
      { ...REQ, region: 'bad;region' },
      { ...REQ, accountId: '12345' },
      { ...REQ, accountId: undefined },
      { ...REQ, roleName: 'a b' },
      { ...REQ, roleName: undefined },
    ];
    for (const req of bad) await expect(call(IPC_CHANNELS.AWS_S3_LIST_BUCKETS, req)).rejects.toThrow(/Invalid/);
    await expect(call(IPC_CHANNELS.AWS_S3_BUCKET_REGION, { ...REQ, bucket: 42 })).rejects.toThrow(/Invalid/);
    expect(listS3Buckets).not.toHaveBeenCalled();
    expect(s3BucketRegion).not.toHaveBeenCalled();
  });

  it('takes the proxy and CA from the AWS settings or a SAVED profile of the main process, never from the request', async () => {
    listS3Buckets.mockResolvedValue([]);
    const hostile = { ...REQ, proxy: { enabled: true, type: 'http', host: 'evil.example', port: 1 }, rejectUnauthorized: false, customCaPath: '/tmp/evil.pem' };
    setAwsNetworkSettings({ httpsProxy: 'http://proxy.corp:8080' });
    await call(IPC_CHANNELS.AWS_S3_LIST_BUCKETS, hostile);
    expect((listS3Buckets.mock.calls[0][1] as { proxy?: { host: string } }).proxy?.host).toBe('proxy.corp');
    expect(JSON.stringify(listS3Buckets.mock.calls[0][1])).not.toContain('evil.example');

    await call(IPC_CHANNELS.AWS_S3_LIST_BUCKETS, { ...REQ, s3ProfileId: 's3-saved' });
    expect((listS3Buckets.mock.calls[1][1] as { proxy?: { host: string } }).proxy?.host).toBe('saved.proxy');
  });

  it('describes an S3 error for the dialog, and returns the region of a bucket', async () => {
    listS3Buckets.mockRejectedValue(Object.assign(new Error('Access Denied'), { name: 'AccessDenied' }));
    await expect(call(IPC_CHANNELS.AWS_S3_LIST_BUCKETS, REQ)).rejects.toThrow(/Access denied/);
    s3BucketRegion.mockResolvedValue('eu-north-1');
    expect(await call(IPC_CHANNELS.AWS_S3_BUCKET_REGION, { ...REQ, bucket: 'a-bucket' })).toBe('eu-north-1');
    expect(s3BucketRegion.mock.calls[0][1]).toBe('a-bucket');
  });
});
