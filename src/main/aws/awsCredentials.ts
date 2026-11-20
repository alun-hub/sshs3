import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { fromSSO } from '@aws-sdk/credential-provider-sso';
import type { SSMClientConfig } from '@aws-sdk/client-ssm';
import { isValidAwsProfile, isValidSsoConfig } from '../../shared/ssm';
import type { AwsSsoNetworkOptions } from '../../shared/types/aws';
import type { AwsCredentialSource } from '../../shared/types/awsScan';
import { buildAwsNodeHttpHandler } from './buildAwsNodeHttpHandler';

export type AwsCredentials = NonNullable<SSMClientConfig['credentials']>;

/** Refresh this long before the credentials expire. */
const REFRESH_MARGIN_MS = 5 * 60_000;

/**
 * Wraps a provider so concurrent and repeated calls (one per region of a scan) share one result until shortly
 * before it expires. The SDK only caches per client, and a scan creates many clients.
 */
export function shareCredentials(provider: () => Promise<{ expiration?: Date }>): () => Promise<any> {
  let current: Promise<{ expiration?: Date }> | undefined;
  const expiring = (c: { expiration?: Date }) => c.expiration !== undefined && c.expiration.getTime() - Date.now() < REFRESH_MARGIN_MS;
  return async () => {
    const mine = (current ??= provider());
    let waiting = mine;
    try {
      const c = await mine;
      if (!expiring(c)) return c;
      // Near expiry: the first caller to notice starts the refresh; the others wait for that same promise.
      if (current === mine) current = provider();
      waiting = current!;
      return await waiting;
    } catch (err) {
      // A failed provider (the first one or its refresh) is retried by the next call, not by every caller that waited on it.
      if (current === waiting || current === mine) current = undefined;
      throw err;
    }
  };
}

/**
 * Credentials for one scan target. SSO uses the token sshs3 cached; profiles and the default chain use the SDK's
 * own provider chain, which reads the AWS CLI configuration like the CLI does (SSO sessions, assume-role, `aws login`,
 * credential_process, environment, instance role). Nothing here prompts: a profile that needs MFA fails with the
 * SDK's error and the UI explains how to sign in once from a terminal.
 */
export function buildCredentialProvider(source: AwsCredentialSource, network: AwsSsoNetworkOptions = {}): AwsCredentials {
  const handler = buildAwsNodeHttpHandler(network);
  if (source.kind === 'sso') {
    const sso = source.sso;
    if (!isValidSsoConfig(sso) || !sso.accountId || !sso.roleName) throw new Error('Choose an AWS account and role first');
    return shareCredentials(
      fromSSO({
        ssoStartUrl: sso.startUrl,
        ssoRegion: sso.region,
        ssoAccountId: sso.accountId,
        ssoRoleName: sso.roleName,
        clientConfig: { requestHandler: handler },
      })
    );
  }
  if (source.kind === 'profile') {
    if (!isValidAwsProfile(source.name)) throw new Error('Invalid AWS CLI profile name');
    return shareCredentials(defaultProvider({ profile: source.name, clientConfig: { requestHandler: handler } }));
  }
  return shareCredentials(defaultProvider({ clientConfig: { requestHandler: handler } }));
}
