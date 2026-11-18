import type { AwsSsoConfig } from './aws';
import type { SsmInstance } from './ssm';

/** Where AWS credentials for a scan come from. */
export type AwsCredentialSource =
  /** sshs3's own IAM Identity Center sign-in; account and role are required. */
  | { kind: 'sso'; sso: AwsSsoConfig }
  /** A named AWS CLI profile (SSO, assume-role, keys, `aws login`, credential_process …); the SDK resolves it like the CLI. */
  | { kind: 'profile'; name: string }
  /** The SDK's default chain (environment, default profile, instance role). */
  | { kind: 'default' };

/** One account/role/profile to search. */
export interface AwsScanTarget {
  id: string;
  /** Shown in the UI and used as the folder name when there is no account name. */
  label: string;
  accountId?: string;
  accountName?: string;
  source: AwsCredentialSource;
}

export interface AwsScanRequest {
  targets: AwsScanTarget[];
  regions: string[];
  /** Windows nodes cannot normally be reached with ssh; hidden unless asked for. */
  includeWindows?: boolean;
}

export interface ScannedInstance extends SsmInstance {
  region: string;
  targetId: string;
  accountId?: string;
  accountName?: string;
}

export type AwsScanSkipReason = 'access-denied' | 'region-disabled' | 'expired' | 'credentials' | 'error';

/** A target/region that could not be searched; the scan carries on with the rest. */
export interface AwsScanSkip {
  targetId: string;
  label: string;
  region?: string;
  reason: AwsScanSkipReason;
  message: string;
}

export interface AwsScanResult {
  instances: ScannedInstance[];
  skipped: AwsScanSkip[];
  /** The instance cap was reached; narrow the accounts or regions. */
  truncated: boolean;
  /** Number of target × region searches that finished (including skipped ones). */
  searched: number;
}

/** One chosen instance, ready to become a profile. */
export interface AwsPickItem {
  instance: ScannedInstance;
  /** How to reach it: the credential source of the account/profile it was found with. */
  source: AwsCredentialSource;
  /** Profile name, already unique within its folder. */
  name: string;
  username: string;
  folder: string;
}

export interface AwsScanProgress {
  done: number;
  total: number;
}

/** A profile found in the user's AWS CLI configuration (names and non-secret facts only). */
export interface AwsCliProfile {
  name: string;
  kind: 'sso' | 'assume-role' | 'process' | 'login' | 'keys' | 'other';
  region?: string;
}

/** Cached IAM Identity Center sign-in state for a start URL; the token itself never leaves the main process. */
export interface AwsSsoStatusInfo {
  status: 'valid' | 'expired' | 'missing';
  expiresAt?: string;
}

/** Account/role listing that reads the token from the main process' cache. */
export interface AwsSsoCachedRequest {
  startUrl: string;
  region: string;
  accountId?: string;
}

export interface AwsScanIpcRequest {
  /** Chosen by the renderer so progress events and a cancel can be matched to this scan. */
  scanId: string;
  request: AwsScanRequest;
}

export interface AwsScanProgressEvent extends AwsScanProgress {
  scanId: string;
}

/** Whether an AWS CLI profile can produce credentials right now (resolved without prompting). */
export interface AwsProfileStatus {
  ok: boolean;
  expiresAt?: string;
  message?: string;
}

export interface AwsProfileLoginResult {
  ok: boolean;
  message?: string;
}
