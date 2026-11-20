import { globalAwsNetwork } from './awsNetworkSettings';
import { normalizeStartUrl } from '../../shared/ssm';
import type { AwsSsoNetworkOptions } from '../../shared/types/aws';
import type { ProfileStore } from '../profile/ProfileStore';

/** The network fields of an S3 profile that can carry a proxy / CA / TLS choice. */
export interface ProfileNetworkFields {
  proxy?: AwsSsoNetworkOptions['proxy'];
  customCaPath?: string;
  rejectUnauthorized?: boolean;
}

/**
 * The route for a call that carries the SSO access token (device-flow `CreateToken`, account and role lists). A profile
 * may bring its own proxy and CA, but it can NEVER relax TLS verification below what the AWS settings allow: `false` is
 * replaced by the global value. Everything a profile does not set (proxy, CA, TLS) comes from the AWS settings.
 */
export function capProfileNetwork(profile: ProfileNetworkFields | undefined, global: AwsSsoNetworkOptions | undefined): AwsSsoNetworkOptions | undefined {
  if (!profile || (!profile.proxy && !profile.customCaPath && profile.rejectUnauthorized === undefined)) return global;
  // Field by field: whatever the profile does not set comes from the AWS settings (a profile with only its own proxy
  // still trusts the corporate CA of the settings page, and one with only a CA still uses the settings proxy).
  return {
    customCaPath: profile.customCaPath ?? global?.customCaPath,
    proxy: profile.proxy ?? global?.proxy,
    rejectUnauthorized: profile.rejectUnauthorized === false ? global?.rejectUnauthorized : (profile.rejectUnauthorized ?? global?.rejectUnauthorized),
  };
}

/**
 * Network for a sign-in or listing: the SAVED S3 profile with this id when it is signed in to this very start URL and
 * region (looked up here, never taken from the caller), otherwise the AWS settings. SECURITY: the renderer supplies at
 * most an id, so it cannot choose where the token is sent or switch off TLS verification.
 */
export async function networkForSavedS3Profile(
  store: Pick<ProfileStore, 'getProfiles'> | undefined,
  s3ProfileId: unknown,
  startUrl: string,
  region: string
): Promise<AwsSsoNetworkOptions | undefined> {
  const global = globalAwsNetwork();
  if (typeof s3ProfileId !== 'string' || !store) return global;
  const saved = (await store.getProfiles()).s3?.find((p) => p.id === s3ProfileId);
  if (!saved?.sso?.startUrl || normalizeStartUrl(saved.sso.startUrl) !== normalizeStartUrl(startUrl) || (saved.sso.region ?? region) !== region) return global;
  return capProfileNetwork(saved, global);
}
