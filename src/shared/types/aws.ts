import type { ProxyConfig } from './storage';

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

export interface AwsSsoAccount {
  accountId: string;
  accountName?: string;
  emailAddress?: string;
}

export interface AwsSsoAccountRole {
  roleName: string;
}
