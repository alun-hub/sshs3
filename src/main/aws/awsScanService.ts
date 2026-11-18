import { SSMClient, paginateDescribeInstanceInformation, type SSMClientConfig } from '@aws-sdk/client-ssm';
import { MAX_SCAN_INSTANCES, MAX_SCAN_JOBS, dedupeInstances } from '../../shared/awsScan';
import { isValidRegion, mapInstances } from '../../shared/ssm';
import type { AwsSsoNetworkOptions } from '../../shared/types/aws';
import { AWS_SSO_EXPIRED_PREFIX } from '../../shared/types/aws';
import type {
  AwsScanProgress,
  AwsScanRequest,
  AwsScanResult,
  AwsScanSkip,
  AwsScanTarget,
  ScannedInstance,
} from '../../shared/types/awsScan';
import { buildCredentialProvider, type AwsCredentials } from './awsCredentials';
import { isAwsCredentialsError, isAwsSsoSessionError } from './awsErrors';
import { buildAwsNodeHttpHandler } from './buildAwsNodeHttpHandler';
import { fetchEc2Names } from './ec2Names';

export interface ScanOptions {
  network?: AwsSsoNetworkOptions;
  /** Simultaneous target × region searches (default 4). */
  concurrency?: number;
  signal?: AbortSignal;
  onProgress?: (progress: AwsScanProgress) => void;
  /** Look up EC2 Name tags (needs ec2:DescribeInstances; silently skipped when denied). Default true. */
  includeNames?: boolean;
  /** Main-internal test seams. */
  credentialsFor?: (target: AwsScanTarget) => AwsCredentials;
  clientOverrides?: (target: AwsScanTarget, region: string) => Partial<SSMClientConfig>;
  ec2Overrides?: Record<string, unknown>;
}

const ACCESS_DENIED = new Set(['AccessDeniedException', 'AccessDenied', 'UnauthorizedOperation']);
// What a region that is not enabled for the account answers with.
const REGION_DISABLED = new Set(['UnrecognizedClientException', 'InvalidClientTokenId', 'AuthFailure', 'OptInRequired']);

/** Sorts a failed search into a reason the UI can summarise ("access denied ×3"). */
export function classifyScanError(err: unknown): Pick<AwsScanSkip, 'reason' | 'message'> {
  if (isAwsSsoSessionError(err)) return { reason: 'expired', message: `${AWS_SSO_EXPIRED_PREFIX}: sign in again to continue.` };
  const name = err instanceof Error ? err.name : '';
  if (ACCESS_DENIED.has(name)) return { reason: 'access-denied', message: 'Not allowed to call ssm:DescribeInstanceInformation.' };
  if (REGION_DISABLED.has(name)) return { reason: 'region-disabled', message: 'The region is not enabled for this account.' };
  if (isAwsCredentialsError(err)) {
    const detail = err instanceof Error ? err.message.replace(/^Error:\s*/, '') : String(err);
    return { reason: 'credentials', message: detail };
  }
  const code = (err as { code?: string } | undefined)?.code;
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return { reason: 'region-disabled', message: 'The regional endpoint could not be reached.' };
  return { reason: 'error', message: (err instanceof Error && err.message) || 'AWS request failed' };
}

/**
 * Searches target × region for SSM-managed nodes (`DescribeInstanceInformation`, online only) with bounded concurrency.
 * A failed search is recorded and skipped, never fatal: enterprise organisations deny regions and roles as a matter of
 * course. Read-only; credentials stay in this process.
 */
export async function scanInstances(req: AwsScanRequest, opts: ScanOptions = {}): Promise<AwsScanResult> {
  const regions = [...new Set(req.regions)];
  if (regions.length === 0 || req.targets.length === 0) throw new Error('Choose at least one account or profile and one region');
  if (!regions.every(isValidRegion)) throw new Error('Invalid AWS region');
  const jobs: Array<{ target: AwsScanTarget; region: string }> = [];
  for (const target of req.targets) for (const region of regions) jobs.push({ target, region });
  if (jobs.length > MAX_SCAN_JOBS) throw new Error(`Too many searches (${jobs.length}); choose fewer accounts or regions (limit ${MAX_SCAN_JOBS})`);

  const concurrency = Math.max(1, Math.min(opts.concurrency ?? 4, 8));
  const handler = buildAwsNodeHttpHandler(opts.network);
  const credentials = new Map<string, AwsCredentials | Error>();
  const credsFor = (target: AwsScanTarget): AwsCredentials | Error => {
    let c = credentials.get(target.id);
    if (!c) {
      try {
        c = opts.credentialsFor ? opts.credentialsFor(target) : buildCredentialProvider(target.source, opts.network);
      } catch (err) {
        c = err instanceof Error ? err : new Error(String(err));
      }
      credentials.set(target.id, c);
    }
    return c;
  };

  const found: ScannedInstance[] = [];
  const skipped: AwsScanSkip[] = [];
  const namesDenied = new Set<string>();
  let truncated = false;
  let done = 0;
  let next = 0;

  const searchOne = async (target: AwsScanTarget, region: string): Promise<void> => {
    const creds = credsFor(target);
    if (creds instanceof Error) {
      skipped.push({ targetId: target.id, label: target.label, region, reason: 'error', message: creds.message });
      return;
    }
    const client = new SSMClient({
      region,
      credentials: creds,
      requestHandler: handler,
      ...(opts.clientOverrides?.(target, region) ?? {}),
    });
    try {
      const records: Array<Record<string, unknown>> = [];
      const pages = paginateDescribeInstanceInformation(
        { client },
        { Filters: [{ Key: 'PingStatus', Values: ['Online'] }], MaxResults: 50 }
      );
      for await (const page of pages) {
        for (const info of page.InstanceInformationList ?? []) records.push(info as Record<string, unknown>);
        if (found.length + records.length >= MAX_SCAN_INSTANCES) break;
      }
      let instances = mapInstances(records);
      if (!req.includeWindows) instances = instances.filter((i) => i.platformType !== 'Windows');

      let names = new Map<string, string>();
      if ((opts.includeNames ?? true) && instances.length > 0 && !namesDenied.has(target.id)) {
        const r = await fetchEc2Names(instances.map((i) => i.instanceId), region, creds, handler, opts.ec2Overrides);
        names = r.names;
        if (r.denied) namesDenied.add(target.id);
      }
      for (const i of instances) {
        found.push({
          ...i,
          name: names.get(i.instanceId) ?? i.name,
          region,
          targetId: target.id,
          accountId: target.accountId,
          accountName: target.accountName,
        });
      }
    } catch (err) {
      skipped.push({ targetId: target.id, label: target.label, region, ...classifyScanError(err) });
    } finally {
      client.destroy();
    }
  };

  const worker = async (): Promise<void> => {
    while (next < jobs.length && !opts.signal?.aborted && !truncated) {
      const job = jobs[next++];
      await searchOne(job.target, job.region);
      done++;
      if (found.length >= MAX_SCAN_INSTANCES) truncated = true;
      opts.onProgress?.({ done, total: jobs.length });
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, () => worker()));

  const unique = dedupeInstances(found);
  if (unique.length > MAX_SCAN_INSTANCES) truncated = true;
  return { instances: unique.slice(0, MAX_SCAN_INSTANCES), skipped, truncated, searched: done };
}
