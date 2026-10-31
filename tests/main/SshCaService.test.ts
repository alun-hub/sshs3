import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { SshCaService } from '../../src/main/ca/SshCaService';
import type { SshCaConfig, ISshCaProvider, SshCaSignRequest, SshCaSignResponse } from '../../src/shared/types/sshCa';

describe('SshCaService', () => {
  // Real sample certificate valid from 2026-10-31 to 2026-11-01
  const sampleCertWireBase64 =
    'AAAAHHNzaC1yc2EtY2VydC12MDFAb3BlbnNzaC5jb20AAAAgJ21RM2FxLElfKyU1Z3gjLlxaNXxpe0V6TitpU3x2alIAAAADAQABAAABAQDEEUpxaBHoxtL4G6KEgfse8F29QCyKamj5c/3QviDSEG0Te5mpxw2o5ldX7pHd4lEanah61kZ6vVqoB0b/BpAzU53esQOTHDfs11DEN3T6j1GJq2ZRRp34KMYeWOywJzloBZMQ8YCKtUFhsgixGkkxqoz1GifaXTjT0OnM8/3lR2ZSR6GAvbi1kCLzXO6n3y48JstZfkMeHqnvw6d+n7qU9yAHvc6moBSE+DbNgmX73inPN/XYlonMQhIqcxPQymUS67tolPd10pgT6Kh3asqDZ9Oyx1RpiNIRzEge8PgkuPT70QE4nMgB2Ys+7aLbPLOdjg1KMExJxC28qRh4zsiDAVrHJa9YotsAAAABAAAADGFsdW5AYWx1bi5zZQAAABgAAAAEYWx1bgAAAAxhbHVuQGFsdW4uc2UAAAAAauYGDgAAAABq5udKAAAAAAAAAIIAAAAVcGVybWl0LVgxMS1mb3J3YXJkaW5nAAAAAAAAABdwZXJtaXQtYWdlbnQtZm9yd2FyZGluZwAAAAAAAAAWcGVybWl0LXBvcnQtZm9yd2FyZGluZwAAAAAAAAAKcGVybWl0LXB0eQAAAAAAAAAOcGVybWl0LXVzZXItcmMAAAAAAAAAAAAAAGgAAAATZWNkc2Etc2hhMi1uaXN0cDI1NgAAAAhuaXN0cDI1NgAAAEEEwyeJ3D/9ncHEEJ5zqx1Jmsnu/Bj7yNU0GeGJRpcoXGGTtwai2E6K8OxOQaqZHckG4VjzyIWsaCE28FsQ1l8/cgAAAGMAAAATZWNkc2Etc2hhMi1uaXN0cDI1NgAAAEgAAAAgKMAvci3VQ/EDWnscbZpB8bfmM0cnQFOm6MJc7aqusQkAAAAgVFiCXPtaEowFvCXcom0aptByOmvDoWecSJP6WUzl9Ac=';

  let mockOidcServer: http.Server;
  let oidcBaseUrl = '';

  beforeEach(async () => {
    // Start mock OIDC server
    mockOidcServer = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', oidcBaseUrl);

      if (url.pathname === '/.well-known/openid-configuration') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            issuer: oidcBaseUrl,
            authorization_endpoint: `${oidcBaseUrl}/auth`,
            token_endpoint: `${oidcBaseUrl}/token`,
          })
        );
        return;
      }

      if (url.pathname === '/token' && req.method === 'POST') {
        // Construct dummy JWT with user claims
        const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
        const payload = Buffer.from(
          JSON.stringify({
            sub: 'user-123',
            preferred_username: 'alun',
            email: 'alun@alun.se',
          })
        ).toString('base64url');
        const idToken = `${header}.${payload}.signature`;

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            id_token: idToken,
            access_token: 'dummy-access',
            refresh_token: 'dummy-refresh',
            expires_in: 3600,
          })
        );
        return;
      }

      res.writeHead(404).end();
    });

    await new Promise<void>((resolve) => {
      mockOidcServer.listen(0, '127.0.0.1', () => {
        const addr = mockOidcServer.address() as AddressInfo;
        oidcBaseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => mockOidcServer.close(() => resolve()));
  });

  it('starts inactive and reports inactive status', () => {
    const mockAppAgent = {
      addCertifiedEd25519Key: vi.fn(),
      removeIdentities: vi.fn(),
    } as any;

    const service = new SshCaService({ appAgent: mockAppAgent });
    const status = service.getStatus();
    expect(status.active).toBe(false);
  });

  it('executes login flow, signs cert, loads key into agent, and updates status', async () => {
    const mockAppAgent = {
      addCertifiedEd25519Key: vi.fn().mockResolvedValue(undefined),
      removeIdentities: vi.fn().mockResolvedValue(0),
    } as any;

    const mockProvider: ISshCaProvider = {
      id: 'step-ca',
      sign: vi.fn().mockImplementation(async (req: SshCaSignRequest): Promise<SshCaSignResponse> => {
        expect(req.username).toBe('alun');
        expect(req.keyType).toBe('ssh-ed25519');
        return {
          certificateWireBase64: sampleCertWireBase64,
          certificateLine: `ssh-rsa-cert-v01@openssh.com ${sampleCertWireBase64} comment`,
        };
      }),
    };

    let openedBrowserUrl = '';
    const openExternal = vi.fn().mockImplementation(async (targetUrl: string) => {
      openedBrowserUrl = targetUrl;
      const parsedUrl = new URL(targetUrl);
      const redirectUri = parsedUrl.searchParams.get('redirect_uri')!;
      const state = parsedUrl.searchParams.get('state')!;

      // Complete loopback request
      const cbUrl = new URL(redirectUri);
      cbUrl.searchParams.set('code', 'test-auth-code');
      cbUrl.searchParams.set('state', state);

      http.get(cbUrl.toString());
    });

    const testConfig: SshCaConfig = {
      id: 'cfg-1',
      name: 'Test Step CA',
      backend: 'step-ca',
      caUrl: 'https://ca.example.com',
      oidcIssuerUrl: oidcBaseUrl,
      oidcClientId: 'step-ca',
      keySource: 'ephemeral',
      defaultPrincipals: ['alun'],
    };

    const service = new SshCaService({
      appAgent: mockAppAgent,
      openExternal,
      providers: new Map([['step-ca', mockProvider]]),
    });

    const statusList: boolean[] = [];
    service.onStatusChanged((s) => statusList.push(s.active));

    const status = await service.login(testConfig);
    expect(status.active).toBe(true);
    expect(status.username).toBe('alun');
    expect(status.principals).toEqual(['alun', 'alun@alun.se']);
    expect(openedBrowserUrl).toContain('/auth?client_id=step-ca');
    expect(mockAppAgent.addCertifiedEd25519Key).toHaveBeenCalledTimes(1);
    expect(statusList).toContain(true);

    // Test logout
    await service.logout();
    expect(mockAppAgent.removeIdentities).toHaveBeenCalledTimes(1);
    expect(service.getStatus().active).toBe(false);
  });

  it('renews session using refresh token without prompting in browser', async () => {
    const mockAppAgent = {
      addCertifiedEd25519Key: vi.fn().mockResolvedValue(undefined),
      removeIdentities: vi.fn().mockResolvedValue(0),
    } as any;

    const mockProvider: ISshCaProvider = {
      id: 'step-ca',
      sign: vi.fn().mockImplementation(async (): Promise<SshCaSignResponse> => {
        return {
          certificateWireBase64: sampleCertWireBase64,
          certificateLine: `ssh-rsa-cert-v01@openssh.com ${sampleCertWireBase64} comment`,
        };
      }),
    };

    const openExternal = vi.fn().mockImplementation(async (targetUrl: string) => {
      const parsedUrl = new URL(targetUrl);
      const redirectUri = parsedUrl.searchParams.get('redirect_uri')!;
      const state = parsedUrl.searchParams.get('state')!;

      const cbUrl = new URL(redirectUri);
      cbUrl.searchParams.set('code', 'test-auth-code');
      cbUrl.searchParams.set('state', state);

      http.get(cbUrl.toString());
    });

    const testConfig: SshCaConfig = {
      id: 'cfg-1',
      name: 'Test Step CA',
      backend: 'step-ca',
      caUrl: 'https://ca.example.com',
      oidcIssuerUrl: oidcBaseUrl,
      oidcClientId: 'step-ca',
      keySource: 'ephemeral',
      defaultPrincipals: ['alun'],
    };

    const service = new SshCaService({
      appAgent: mockAppAgent,
      openExternal,
      providers: new Map([['step-ca', mockProvider]]),
    });

    await service.login(testConfig);
    expect(openExternal).toHaveBeenCalledTimes(1);

    // Renew
    const renewed = await service.renew();
    expect(renewed.active).toBe(true);
    // Should NOT have opened the browser again because refresh token succeeded!
    expect(openExternal).toHaveBeenCalledTimes(1);
    expect(mockAppAgent.addCertifiedEd25519Key).toHaveBeenCalledTimes(2);
  });
});
