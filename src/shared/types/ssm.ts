import type { AwsSsoConfig } from './aws';

/**
 * SSH over AWS Systems Manager: OpenSSH reaches the instance through
 * `aws ssm start-session --document-name AWS-StartSSHSession` as its ProxyCommand.
 * At most one of `awsProfile` / `sso` is set; neither = the AWS CLI's default credential chain.
 */
export interface SshSsmConfig {
  enabled: true;
  region?: string;
  /** Name of an existing AWS CLI profile (e.g. after `aws sso login`). */
  awsProfile?: string;
  /** Sign in through sshs3's own IAM Identity Center flow (shared with S3 profiles). */
  sso?: AwsSsoConfig;
}

export interface AwsSsmToolStatus {
  found: boolean;
  path?: string;
  version?: string;
  /** Plugin only: version meets the minimum for SSH sessions. */
  ok?: boolean;
}

export interface AwsSsmTools {
  aws: AwsSsmToolStatus;
  plugin: AwsSsmToolStatus;
}

/** One SSM-managed node as shown in the instance picker (all strings already sanitised). */
export interface SsmInstance {
  instanceId: string;
  /** SSM `ComputerName` (the EC2 Name tag needs ec2:DescribeInstances and is not used). */
  name: string;
  platformName?: string;
  platformType?: 'Windows' | 'Linux' | 'MacOS';
  ipAddress?: string;
  pingStatus?: 'Online' | 'ConnectionLost' | 'Inactive';
}
