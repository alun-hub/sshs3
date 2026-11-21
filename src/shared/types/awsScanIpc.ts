import type { AwsSsoAccount, AwsSsoAccountRole } from './aws';
import type {
  AwsCliProfile,
  AwsS3Bucket,
  AwsS3BucketsRequest,
  AwsProfileLoginResult,
  AwsProfileStatus,
  AwsScanIpcRequest,
  AwsScanProgressEvent,
  AwsScanResult,
  AwsSsoCachedRequest,
  AwsSsoStatusInfo,
} from './awsScan';

/**
 * IPC channels and renderer API for AWS scanning, CLI profiles and cached SSO sign-ins. Kept apart from
 * `ipc.ts` (which has a line ceiling); spread into `IPC_CHANNELS` and `MultiSSHApi` there.
 */
export const AWS_SCAN_CHANNELS = {
  AWS_SSM_SCAN: 'aws-ssm:scan',
  AWS_SSM_SCAN_PROGRESS: 'aws-ssm:scan-progress',
  AWS_SSM_SCAN_CANCEL: 'aws-ssm:scan-cancel',
  AWS_SSM_LIST_PROFILES: 'aws-ssm:list-profiles',
  AWS_SSM_PROFILE_STATUS: 'aws-ssm:profile-status',
  AWS_SSM_PROFILE_LOGIN: 'aws-ssm:profile-login',
  AWS_SSO_STATUS: 'aws-sso:status',
  AWS_SSO_LIST_ACCOUNTS_CACHED: 'aws-sso:list-accounts-cached',
  AWS_SSO_LIST_ROLES_CACHED: 'aws-sso:list-roles-cached',
  AWS_S3_LIST_BUCKETS: 'aws-s3:list-buckets',
  AWS_S3_BUCKET_REGION: 'aws-s3:bucket-region',
} as const;

export interface AwsScanElectronApi {
  /** Searches accounts/profiles x regions for SSM-managed nodes; progress arrives through onAwsSsmScanProgress. */
  awsSsmScan(request: AwsScanIpcRequest): Promise<AwsScanResult>;
  awsSsmScanCancel(scanId: string): Promise<void>;
  onAwsSsmScanProgress(callback: (event: AwsScanProgressEvent) => void): () => void;
  /** Profiles in the user's AWS CLI configuration (names and non-secret facts only). */
  awsSsmListProfiles(): Promise<AwsCliProfile[]>;
  awsSsmProfileStatus(name: string): Promise<AwsProfileStatus>;
  /** Runs `aws sso login --profile <name>` for an SSO profile (the CLI opens the browser). */
  awsSsmProfileLogin(name: string): Promise<AwsProfileLoginResult>;
  /** Sign-in state for a start URL, read from the main process' token cache (the token is never returned). */
  awsSsoStatus(startUrl: string): Promise<AwsSsoStatusInfo>;
  awsSsoListAccountsCached(request: AwsSsoCachedRequest): Promise<AwsSsoAccount[]>;
  awsSsoListRolesCached(request: AwsSsoCachedRequest): Promise<AwsSsoAccountRole[]>;
  /** The buckets an account/role can list (needs s3:ListAllMyBuckets; the call fails with the S3 message when it is denied). */
  awsS3ListBuckets(request: AwsS3BucketsRequest): Promise<AwsS3Bucket[]>;
  /** The region of one bucket (undefined when it cannot be told), for the Region field of the profile. */
  awsS3BucketRegion(request: AwsS3BucketsRequest & { bucket: string }): Promise<string | undefined>;
}
