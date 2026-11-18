import { SSMClient, paginateDescribeInstanceInformation, type SSMClientConfig } from '@aws-sdk/client-ssm';
import { fromSSO } from '@aws-sdk/credential-provider-sso';
import { MAX_DISCOVERED_INSTANCES, isValidRegion, isValidSsoConfig, mapInstances } from '../../shared/ssm';
import type { AwsSsoNetworkOptions } from '../../shared/types/aws';
import type { SsmDiscoveryRequest, SsmDiscoveryResult } from '../../shared/types/ssm';
import { AWS_SSO_CREDENTIALS_PREFIX, AWS_SSO_EXPIRED_PREFIX } from '../../shared/types/aws';
import { isAwsCredentialsError, isAwsSsoSessionError } from './awsErrors';
import { buildAwsNodeHttpHandler } from './buildAwsNodeHttpHandler';

/**
 * Lists SSM-managed nodes (`DescribeInstanceInformation`) in one account/role and region, using the
 * token sshs3 already cached for IAM Identity Center. Read-only; no credentials leave this process.
 */
export async function discoverInstances(
  req: SsmDiscoveryRequest,
  network: AwsSsoNetworkOptions = {},
  /** Main-process-internal test seam (endpoint, credentials, TLS trust for a local emulator); never reachable from IPC. */
  clientOverrides: Partial<SSMClientConfig> = {}
): Promise<SsmDiscoveryResult> {
  if (!isValidSsoConfig(req.sso) || !req.sso.accountId || !req.sso.roleName) {
    throw new Error('Choose an AWS account and role first');
  }
  if (!isValidRegion(req.region)) throw new Error('Invalid AWS region');

  const handler = buildAwsNodeHttpHandler(network);
  const client = new SSMClient({
    region: req.region,
    requestHandler: handler,
    credentials: fromSSO({
      ssoStartUrl: req.sso.startUrl,
      ssoRegion: req.sso.region,
      ssoAccountId: req.sso.accountId,
      ssoRoleName: req.sso.roleName,
      clientConfig: { requestHandler: handler },
    }),
    ...clientOverrides,
  });

  try {
    const records: Array<Record<string, unknown>> = [];
    let truncated = false;
    const pages = paginateDescribeInstanceInformation(
      { client },
      { Filters: [{ Key: 'PingStatus', Values: ['Online'] }], MaxResults: 50 }
    );
    outer: for await (const page of pages) {
      for (const info of page.InstanceInformationList ?? []) {
        if (records.length >= MAX_DISCOVERED_INSTANCES) {
          truncated = true;
          break outer;
        }
        records.push(info as Record<string, unknown>);
      }
    }
    return { instances: mapInstances(records), truncated };
  } catch (err) {
    throw new Error(describeDiscoveryError(err), { cause: err });
  } finally {
    client.destroy();
  }
}

/** Message for a failed discovery; keeps SSO expiry distinguishable (the UI offers a sign-in for those prefixes). */
export function describeDiscoveryError(err: unknown): string {
  if (isAwsSsoSessionError(err)) return `${AWS_SSO_EXPIRED_PREFIX}: sign in again to continue.`;
  if (isAwsCredentialsError(err)) {
    const detail = err instanceof Error ? err.message.replace(/^Error:\s*/, '') : String(err);
    return `${AWS_SSO_CREDENTIALS_PREFIX}: ${detail} Try signing in again.`;
  }
  const name = err instanceof Error ? err.name : '';
  if (name === 'AccessDeniedException' || name === 'AccessDenied') {
    return 'Access denied: the signed-in role is not allowed to call ssm:DescribeInstanceInformation.';
  }
  return (err instanceof Error && err.message) || 'AWS request failed';
}
