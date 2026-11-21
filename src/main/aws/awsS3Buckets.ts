import { HeadBucketCommand, ListBucketsCommand, S3Client } from '@aws-sdk/client-s3';
import type { AwsSsoConfig, AwsSsoNetworkOptions } from '../../shared/types/aws';
import type { AwsS3Bucket } from '../../shared/types/awsScan';
import { buildCredentialProvider } from './awsCredentials';
import { buildAwsNodeHttpHandler } from './buildAwsNodeHttpHandler';

/** More buckets than this are cut off (an account can hold thousands; a picker is for choosing among a few). */
const MAX_BUCKETS = 1000;
const PAGE_SIZE = 500;
/** ListBuckets answers for the whole account from any region; the choice of region does not matter. */
const LIST_REGION = 'us-east-1';
const BUCKET_NAME = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const REGION_NAME = /^[a-z0-9-]{2,30}$/;

function clientFor(sso: AwsSsoConfig, network: AwsSsoNetworkOptions | undefined): S3Client {
  return new S3Client({
    region: LIST_REGION,
    credentials: buildCredentialProvider({ kind: 'sso', sso }, network),
    requestHandler: buildAwsNodeHttpHandler(network),
  });
}

/**
 * The buckets this account/role can list, sorted by name. Needs `s3:ListAllMyBuckets`; without it S3 answers AccessDenied and the
 * caller shows that. Names come from AWS but are still checked, because they end up in a form field.
 */
export async function listS3Buckets(sso: AwsSsoConfig, network?: AwsSsoNetworkOptions): Promise<AwsS3Bucket[]> {
  const client = clientFor(sso, network);
  try {
    const names: string[] = [];
    let token: string | undefined;
    do {
      const page = await client.send(new ListBucketsCommand({ ContinuationToken: token, MaxBuckets: PAGE_SIZE }));
      for (const b of page.Buckets ?? []) if (b.Name && BUCKET_NAME.test(b.Name)) names.push(b.Name);
      token = page.ContinuationToken;
    } while (token && names.length < MAX_BUCKETS);
    return [...new Set(names)].sort().slice(0, MAX_BUCKETS).map((name) => ({ name }));
  } finally {
    client.destroy();
  }
}

/**
 * The region of one bucket. ListBuckets does not say; HeadBucket answers with `x-amz-bucket-region` whether it succeeds, is
 * denied or is redirected (a bucket in another region than this client's), so the header is read from the response or the error.
 */
export async function s3BucketRegion(sso: AwsSsoConfig, bucket: string, network?: AwsSsoNetworkOptions): Promise<string | undefined> {
  if (!BUCKET_NAME.test(bucket)) throw new Error('Invalid bucket name');
  const client = clientFor(sso, network);
  try {
    let region: string | undefined;
    try {
      const out = await client.send(new HeadBucketCommand({ Bucket: bucket }));
      region = out.BucketRegion;
    } catch (err) {
      region = (err as { $response?: { headers?: Record<string, string> } }).$response?.headers?.['x-amz-bucket-region'];
    }
    return region && REGION_NAME.test(region) ? region : undefined;
  } finally {
    client.destroy();
  }
}
