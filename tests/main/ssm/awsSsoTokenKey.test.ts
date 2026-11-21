import { describe, it, expect, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fromSSO } from '@aws-sdk/credential-provider-sso';

vi.mock('electron', () => ({ shell: { openExternal: vi.fn() }, app: { getPath: () => os.tmpdir() } }));

import { AwsSsoAuthService } from '../../../src/main/aws/AwsSsoAuthService';
import { normalizeStartUrl } from '../../../src/shared/ssm';

/**
 * The SSO token cache file is named sha1(start URL). A sign-in writes it under the URL login() is given, and the AWS SDK
 * (`fromSSO`, used by the S3 provider) reads it under the URL it is given. This runs the real service and the real SDK
 * provider against a temporary home to keep that pairing honest: a saved URL "as typed" must find the token a sign-in wrote.
 */
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sso-token-key-'));
const previousHome = process.env.HOME;
process.env.HOME = home; // the SDK looks in $HOME/.aws/sso/cache
afterAll(() => {
  process.env.HOME = previousHome;
  fs.rmSync(home, { recursive: true, force: true });
});

const SAVED_AS_TYPED = 'https://d-1234567890.awsapps.com/start#/'; // what the S3 form of v0.97.9 and earlier saved
const roleClient = { send: async () => ({ roleCredentials: { accessKeyId: 'AKIAFAKE', secretAccessKey: 's', sessionToken: 't', expiration: Date.now() + 3_600_000 } }) } as never;
const reader = (startUrl: string) =>
  fromSSO({ ssoStartUrl: startUrl, ssoRegion: 'us-east-1', ssoAccountId: '123456789012', ssoRoleName: 'Dev', ssoClient: roleClient });

type Writer = { writeSsoTokenCache: (startUrl: string, token: unknown) => Promise<void> };
const token = (startUrl: string) => ({
  startUrl, region: 'us-east-1', accessToken: 'tok', expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  clientId: 'c', clientSecret: 's', registrationExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
});

describe('SSO token cache: the file a sign-in writes is the file the S3 provider reads', () => {
  it('finds the token when both use the normalised URL (what login() and the provider now do)', async () => {
    const service = new AwsSsoAuthService({ ssoCacheDir: path.join(home, '.aws', 'sso', 'cache') }) as unknown as Writer;
    await service.writeSsoTokenCache(normalizeStartUrl(SAVED_AS_TYPED), token(normalizeStartUrl(SAVED_AS_TYPED)));
    const credentials = await reader(normalizeStartUrl(SAVED_AS_TYPED))();
    expect(credentials.accessKeyId).toBe('AKIAFAKE');
  });

  it('would NOT find it if the reader used the URL as typed: the mismatch this guards against', async () => {
    // Documents why the provider normalises: a token written under the clean URL is invisible to a reader using "…#/".
    const service = new AwsSsoAuthService({ ssoCacheDir: path.join(home, '.aws', 'sso', 'cache') }) as unknown as Writer;
    await service.writeSsoTokenCache(normalizeStartUrl(SAVED_AS_TYPED), token(normalizeStartUrl(SAVED_AS_TYPED)));
    await expect(reader(SAVED_AS_TYPED)()).rejects.toThrow(/SSO session associated with this profile is invalid/);
  });
});
