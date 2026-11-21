import { describe, it, expect, vi, beforeEach } from 'vitest';

const send = vi.fn();
const destroy = vi.fn();
const ctor = vi.fn();
vi.mock('@aws-sdk/client-s3', () => {
  class S3Client {
    constructor(config: unknown) { ctor(config); }
    send = send;
    destroy = destroy;
  }
  class ListBucketsCommand { constructor(public input: unknown) {} }
  class HeadBucketCommand { constructor(public input: unknown) {} }
  return { S3Client, ListBucketsCommand, HeadBucketCommand };
});
vi.mock('../../../src/main/aws/awsCredentials', () => ({ buildCredentialProvider: vi.fn(() => 'creds-provider') }));
vi.mock('../../../src/main/aws/buildAwsNodeHttpHandler', () => ({ buildAwsNodeHttpHandler: () => ({}) }));

import { listS3Buckets, s3BucketRegion } from '../../../src/main/aws/awsS3Buckets';
import { buildCredentialProvider } from '../../../src/main/aws/awsCredentials';

const SSO = { startUrl: 'https://d-1.awsapps.com/start', region: 'us-east-1', accountId: '123456789012', roleName: 'Dev' };

beforeEach(() => { send.mockReset(); destroy.mockClear(); ctor.mockClear(); });

describe('listS3Buckets', () => {
  it('lists all pages, sorted, with valid bucket names only, and always closes the client', async () => {
    send
      .mockResolvedValueOnce({ Buckets: [{ Name: 'zeta-bucket' }, { Name: 'Bad Name!' }, { Name: 'alpha-bucket' }], ContinuationToken: 'next' })
      .mockResolvedValueOnce({ Buckets: [{ Name: 'alpha-bucket' }, { Name: 'mid.bucket' }] });
    const list = await listS3Buckets(SSO, { proxy: undefined });
    expect(list.map((b) => b.name)).toEqual(['alpha-bucket', 'mid.bucket', 'zeta-bucket']);
    expect((send.mock.calls[1][0] as { input: { ContinuationToken: string } }).input.ContinuationToken).toBe('next');
    expect(buildCredentialProvider).toHaveBeenCalledWith({ kind: 'sso', sso: SSO }, { proxy: undefined });
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('passes an S3 error on (the handler describes it) and still closes the client', async () => {
    send.mockRejectedValueOnce(Object.assign(new Error('Access Denied'), { name: 'AccessDenied' }));
    await expect(listS3Buckets(SSO)).rejects.toThrow('Access Denied');
    expect(destroy).toHaveBeenCalledOnce();
  });
});

describe('s3BucketRegion', () => {
  it('reads the region from the redirect that HeadBucket gets from another region', async () => {
    send.mockRejectedValueOnce(Object.assign(new Error('x'), { $response: { headers: { 'x-amz-bucket-region': 'eu-north-1' } } }));
    expect(await s3BucketRegion(SSO, 'my-bucket')).toBe('eu-north-1');
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('reads it from a successful answer, and returns undefined when it cannot be told or is not a region name', async () => {
    send.mockResolvedValueOnce({ BucketRegion: 'us-east-1' });
    expect(await s3BucketRegion(SSO, 'my-bucket')).toBe('us-east-1');
    send.mockRejectedValueOnce(Object.assign(new Error('Not Found'), { $response: { headers: {} } }));
    expect(await s3BucketRegion(SSO, 'my-bucket')).toBeUndefined();
    send.mockRejectedValueOnce(Object.assign(new Error('x'), { $response: { headers: { 'x-amz-bucket-region': 'x"; rm -rf /' } } }));
    expect(await s3BucketRegion(SSO, 'my-bucket')).toBeUndefined();
  });

  it('refuses a bucket name that is not a bucket name, before any call', async () => {
    await expect(s3BucketRegion(SSO, '../etc/passwd')).rejects.toThrow('Invalid bucket name');
    expect(ctor).not.toHaveBeenCalled();
  });
});
