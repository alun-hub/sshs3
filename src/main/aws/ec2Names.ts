import { nameFromTags } from '../../shared/awsScan';
import type { AwsCredentials } from './awsCredentials';

const CHUNK = 100;

/** True for the errors that mean "this role may not read EC2 tags"; the scan then keeps the SSM host names. */
export function isEc2DeniedError(err: unknown): boolean {
  const name = err instanceof Error ? err.name : '';
  return ['UnauthorizedOperation', 'AccessDenied', 'AccessDeniedException', 'AuthFailure', 'UnrecognizedClientException'].includes(name);
}

/**
 * Name tags of EC2 instances (`ec2:DescribeInstances`). Optional: the client is loaded on first use, and a role without
 * the permission just gets an empty map (the caller keeps the SSM host names and stops asking for that target).
 * @param overrides main-internal test seam
 */
export async function fetchEc2Names(
  instanceIds: readonly string[],
  region: string,
  credentials: AwsCredentials,
  requestHandler?: unknown,
  overrides: Record<string, unknown> = {},
  signal?: AbortSignal
): Promise<{ names: Map<string, string>; denied: boolean }> {
  const names = new Map<string, string>();
  const ec2Ids = instanceIds.filter((id) => id.startsWith('i-'));
  if (ec2Ids.length === 0) return { names, denied: false };
  const { EC2Client, DescribeInstancesCommand } = await import('@aws-sdk/client-ec2');
  const client = new EC2Client({ region, credentials, ...(requestHandler ? { requestHandler: requestHandler as never } : {}), ...overrides });
  const abort = () => client.destroy();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    for (let i = 0; i < ec2Ids.length; i += CHUNK) {
      const resp = await client.send(new DescribeInstancesCommand({ InstanceIds: ec2Ids.slice(i, i + CHUNK) }));
      for (const r of resp.Reservations ?? []) {
        for (const inst of r.Instances ?? []) {
          const name = nameFromTags(inst.Tags);
          if (inst.InstanceId && name) names.set(inst.InstanceId, name);
        }
      }
    }
    return { names, denied: false };
  } catch (err) {
    if (isEc2DeniedError(err)) return { names, denied: true };
    // Any other failure (throttling, network) must not break the scan; names are a nicety.
    return { names, denied: false };
  } finally {
    signal?.removeEventListener('abort', abort);
    client.destroy();
  }
}
