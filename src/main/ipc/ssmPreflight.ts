import { AWS_SSO_EXPIRED_PREFIX } from '../../shared/types/aws';
import type { SshSsmConfig } from '../../shared/types/ssm';
import type { AwsSsoAuthService } from '../aws/AwsSsoAuthService';

/**
 * Before connecting an SSM profile that uses sshs3's own SSO sign-in: fail fast with the
 * "session expired" prefix when the cached token is gone or lapsed, so the UI can offer a
 * sign-in instead of the user waiting for an opaque AWS CLI error. Profiles using the default
 * credentials or an AWS CLI profile are left to the CLI.
 */
export async function assertSsmSignedIn(
  auth: Pick<AwsSsoAuthService, 'getTokenStatus'>,
  ssm: SshSsmConfig | undefined
): Promise<void> {
  if (!ssm?.enabled || !ssm.sso) return;
  const status = await auth.getTokenStatus(ssm.sso.startUrl);
  if (status !== 'valid') {
    throw new Error(`${AWS_SSO_EXPIRED_PREFIX}: sign in again, then reconnect.`);
  }
}
