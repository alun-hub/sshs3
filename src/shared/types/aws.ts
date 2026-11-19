import type { ProxyConfig } from './storage';

/** Prefix of the file-pane error for a lapsed SSO session; the pane keys on it to offer "Sign in again". */
export const AWS_SSO_EXPIRED_PREFIX = 'AWS SSO session expired';

/** Prefix when an SSO profile could not obtain credentials for another reason (proxy, network, rejected token). */
export const AWS_SSO_CREDENTIALS_PREFIX = 'AWS SSO credentials unavailable';

/**
 * State of the cached SSO token (`~/.aws/sso/cache/<sha1(startUrl)>.json`) for a start URL.
 * Offline: only the file's `expiresAt` is looked at, nothing is sent to AWS.
 */
export type AwsSsoTokenStatus = 'valid' | 'expired' | 'missing';

/** Pure: status from the parsed cache file (or undefined when the file is absent/unparseable). */
export function parseSsoTokenCache(data: unknown, now: number, skewMs = 60_000): AwsSsoTokenStatus {
  if (typeof data !== 'object' || data === null) return 'missing';
  const d = data as { accessToken?: unknown; expiresAt?: unknown };
  if (typeof d.accessToken !== 'string' || !d.accessToken || typeof d.expiresAt !== 'string') return 'missing';
  const expires = Date.parse(d.expiresAt);
  if (Number.isNaN(expires)) return 'missing';
  return expires - skewMs > now ? 'valid' : 'expired';
}

/** True for a pane error that should offer "Sign in again". */
export function offersAwsSsoSignIn(message: string): boolean {
  return message.startsWith(AWS_SSO_EXPIRED_PREFIX) || message.startsWith(AWS_SSO_CREDENTIALS_PREFIX);
}

/** Network settings so the SSO OIDC calls honor the same CA/proxy config as the S3 client. */
export interface AwsSsoNetworkOptions {
  customCaPath?: string;
  rejectUnauthorized?: boolean;
  proxy?: ProxyConfig;
}

export interface AwsSsoDevicePrompt {
  verificationUri: string;
  verificationUriComplete?: string;
  userCode: string;
  expiresIn: number;
}

export interface AwsSsoLoginResult {
  accessToken: string;
  expiresAt: string;
}

/** What the renderer learns from a sign-in: the access token itself never leaves the main process. */
export type AwsSsoLoginInfo = Pick<AwsSsoLoginResult, 'expiresAt'>;

export interface AwsSsoAccount {
  accountId: string;
  accountName?: string;
  emailAddress?: string;
}

export interface AwsSsoAccountRole {
  roleName: string;
}

/** IAM Identity Center (SSO) sign-in target shared by S3 profiles and SSM-routed SSH profiles. */
export interface AwsSsoConfig {
  startUrl: string;
  region: string;
  accountId?: string;
  roleName?: string;
}

/** A saved IAM Identity Center sign-in (start URL + region) offered everywhere AWS is used. Non-secret. */
export interface AwsSignIn {
  id: string;
  name: string;
  startUrl: string;
  region: string;
  /** Last account/role chosen with this sign-in, preselected next time. */
  lastAccountId?: string;
  lastRoleName?: string;
  /** Provided by the organisation's policy: shown locked and not stored in the user's settings. */
  managed?: boolean;
}

/** Network options for every AWS call sshs3 makes and for the `aws` CLI it starts. */
export interface AwsNetworkSettings {
  /** `http(s)://host:port` without credentials (a proxy that needs a login is not supported for the CLI). */
  httpsProxy?: string;
  customCaPath?: string;
  /** Default true. */
  rejectUnauthorized?: boolean;
}
