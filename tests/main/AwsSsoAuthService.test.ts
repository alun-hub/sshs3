import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const sendMock = vi.fn();

vi.mock('@aws-sdk/client-sso-oidc', () => {
  class SSOOIDCServiceException extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'SSOOIDCServiceException';
    }
  }
  class AuthorizationPendingException extends SSOOIDCServiceException {
    constructor() {
      super('AuthorizationPendingException');
      this.name = 'AuthorizationPendingException';
    }
  }
  class SlowDownException extends SSOOIDCServiceException {
    constructor() {
      super('SlowDownException');
      this.name = 'SlowDownException';
    }
  }
  class SSOOIDCClient {
    public config: any;
    public send = sendMock;
    constructor(config: any) {
      this.config = config;
    }
  }
  class RegisterClientCommand {
    constructor(public input: any) {}
  }
  class StartDeviceAuthorizationCommand {
    constructor(public input: any) {}
  }
  class CreateTokenCommand {
    constructor(public input: any) {}
  }

  return {
    SSOOIDCClient,
    RegisterClientCommand,
    StartDeviceAuthorizationCommand,
    CreateTokenCommand,
    AuthorizationPendingException,
    SlowDownException,
  };
});

const listAccountsSendMock = vi.fn();
vi.mock('@aws-sdk/client-sso', () => {
  class SSOClient {
    public config: any;
    public send = listAccountsSendMock;
    constructor(config: any) {
      this.config = config;
    }
  }
  class ListAccountsCommand {
    constructor(public input: any) {}
  }
  class ListAccountRolesCommand {
    constructor(public input: any) {}
  }

  return { SSOClient, ListAccountsCommand, ListAccountRolesCommand };
});

import { AwsSsoAuthService, AwsSsoLoginCancelledError } from '../../src/main/aws/AwsSsoAuthService';
import { AuthorizationPendingException, SlowDownException } from '@aws-sdk/client-sso-oidc';

// The mocked classes above ignore constructor args, but TS still checks calls
// against the real (unmocked) type declarations, which require this shape.
const exceptionOpts = { message: 'mocked', $metadata: {} } as any;
function makeAuthorizationPendingException() {
  return new AuthorizationPendingException(exceptionOpts);
}
function makeSlowDownException() {
  return new SlowDownException(exceptionOpts);
}

describe('AwsSsoAuthService', () => {
  let tempDir: string;
  let clientCacheFilePath: string;
  let ssoCacheDir: string;
  let service: AwsSsoAuthService;

  const startUrl = 'https://example.awsapps.com/start';
  const region = 'us-east-1';

  beforeEach(async () => {
    vi.clearAllMocks();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sshs3-aws-sso-test-'));
    clientCacheFilePath = path.join(tempDir, 'aws-sso-clients.json');
    ssoCacheDir = path.join(tempDir, 'sso-cache');
    service = new AwsSsoAuthService({ clientCacheFilePath, ssoCacheDir });
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  function mockRegisterClient(clientSecretExpiresAt: number) {
    return {
      clientId: 'client-id-1',
      clientSecret: 'client-secret-1',
      clientIdIssuedAt: Math.floor(Date.now() / 1000),
      clientSecretExpiresAt,
    };
  }

  function mockDeviceAuth(overrides: Partial<Record<string, any>> = {}) {
    return {
      deviceCode: 'device-code-1',
      userCode: 'USER-CODE',
      verificationUri: 'https://example.awsapps.com/device',
      verificationUriComplete: 'https://example.awsapps.com/device?user_code=USER-CODE',
      expiresIn: 600,
      interval: 1,
      ...overrides,
    };
  }

  it(
    'registers a client, starts device auth, and resolves once the token is approved',
    async () => {
      const farFuture = Math.floor(Date.now() / 1000) + 999_999;
      sendMock
        .mockResolvedValueOnce(mockRegisterClient(farFuture))
        .mockResolvedValueOnce(mockDeviceAuth())
        .mockResolvedValueOnce({ accessToken: 'access-token-1', expiresIn: 3600 });

      const onPrompt = vi.fn();
      const result = await service.login(startUrl, region, { onPrompt });

      expect(result).toEqual({ accessToken: 'access-token-1', expiresAt: expect.any(String) });
      expect(onPrompt).toHaveBeenCalledWith({
        verificationUri: 'https://example.awsapps.com/device',
        verificationUriComplete: 'https://example.awsapps.com/device?user_code=USER-CODE',
        userCode: 'USER-CODE',
        expiresIn: 600,
      });

      // Token cache written in the same format/location `aws sso login` uses.
      const cacheKey = crypto.createHash('sha1').update(startUrl).digest('hex');
      const cacheFile = path.join(ssoCacheDir, `${cacheKey}.json`);
      const cached = JSON.parse(await fs.readFile(cacheFile, 'utf-8'));
      expect(cached).toMatchObject({
        startUrl,
        region,
        accessToken: 'access-token-1',
        clientId: 'client-id-1',
        clientSecret: 'client-secret-1',
      });
    },
    8000
  );

  it(
    'reuses a cached, unexpired client registration instead of re-registering',
    async () => {
      const farFuture = Math.floor(Date.now() / 1000) + 999_999;

      sendMock
        .mockResolvedValueOnce(mockRegisterClient(farFuture))
        .mockResolvedValueOnce(mockDeviceAuth())
        .mockResolvedValueOnce({ accessToken: 'token-a', expiresIn: 3600 });
      await service.login(startUrl, region);

      sendMock.mockClear();
      sendMock
        .mockResolvedValueOnce(mockDeviceAuth()) // no RegisterClient call expected this time
        .mockResolvedValueOnce({ accessToken: 'token-b', expiresIn: 3600 });
      const result = await service.login(startUrl, region);

      expect(result.accessToken).toBe('token-b');
      expect(sendMock).toHaveBeenCalledTimes(2); // StartDeviceAuthorization + CreateToken only
    },
    8000
  );

  it(
    'keeps polling through AuthorizationPendingException until approval',
    async () => {
      const farFuture = Math.floor(Date.now() / 1000) + 999_999;
      sendMock
        .mockResolvedValueOnce(mockRegisterClient(farFuture))
        .mockResolvedValueOnce(mockDeviceAuth())
        .mockRejectedValueOnce(makeAuthorizationPendingException())
        .mockRejectedValueOnce(makeAuthorizationPendingException())
        .mockResolvedValueOnce({ accessToken: 'token-final', expiresIn: 3600 });

      const result = await service.login(startUrl, region);

      expect(result.accessToken).toBe('token-final');
    },
    8000
  );

  it(
    'backs off on SlowDownException without failing the login',
    async () => {
      const farFuture = Math.floor(Date.now() / 1000) + 999_999;
      sendMock
        .mockResolvedValueOnce(mockRegisterClient(farFuture))
        .mockResolvedValueOnce(mockDeviceAuth())
        .mockRejectedValueOnce(makeSlowDownException())
        .mockResolvedValueOnce({ accessToken: 'token-after-slowdown', expiresIn: 3600 });

      const result = await service.login(startUrl, region);

      expect(result.accessToken).toBe('token-after-slowdown');
    },
    12000
  );

  it(
    'rejects with AwsSsoLoginCancelledError when the signal aborts mid-poll',
    async () => {
      const farFuture = Math.floor(Date.now() / 1000) + 999_999;
      sendMock
        .mockResolvedValueOnce(mockRegisterClient(farFuture))
        .mockResolvedValueOnce(mockDeviceAuth())
        .mockRejectedValue(makeAuthorizationPendingException());

      const controller = new AbortController();
      setTimeout(() => controller.abort(), 1500);

      await expect(service.login(startUrl, region, { signal: controller.signal })).rejects.toBeInstanceOf(
        AwsSsoLoginCancelledError
      );
    },
    8000
  );

  it(
    'throws once the device code expires before approval',
    async () => {
      const farFuture = Math.floor(Date.now() / 1000) + 999_999;
      sendMock
        .mockResolvedValueOnce(mockRegisterClient(farFuture))
        .mockResolvedValueOnce(mockDeviceAuth({ expiresIn: 2, interval: 1 }))
        .mockRejectedValue(makeAuthorizationPendingException());

      await expect(service.login(startUrl, region)).rejects.toThrow(/expired/i);
    },
    8000
  );

  it('lists accounts and account roles for the given access token', async () => {
    listAccountsSendMock
      .mockResolvedValueOnce({
        accountList: [{ accountId: '111', accountName: 'Prod' }, { accountId: '222', accountName: 'Dev' }],
        nextToken: undefined,
      })
      .mockResolvedValueOnce({
        roleList: [{ roleName: 'AdministratorAccess' }, { roleName: 'ReadOnly' }],
        nextToken: undefined,
      });

    const accounts = await service.listAccounts('access-token', region);
    expect(accounts.map((a) => a.accountId)).toEqual(['222', '111']); // sorted by name: Dev, Prod

    const roles = await service.listAccountRoles('access-token', region, '111');
    expect(roles.map((r) => r.roleName)).toEqual(['AdministratorAccess', 'ReadOnly']);
  });
});
