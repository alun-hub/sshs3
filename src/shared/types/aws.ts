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
