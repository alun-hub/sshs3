import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { AppAgent } from '../ssh/AppAgent';
import { ensureSecureDir, resolveAppAgentDir } from '../ssh/AppAgent';
import type { AppSettings } from '../../shared/types/settings';
import type {
  ISshCaProvider,
  SshCaBackendType,
  SshCaCertificateInfo,
  SshCaConfig,
  SshCaStatus,
} from '../../shared/types/sshCa';
import { StepCaProvider } from './providers/StepCaProvider';
import { VaultCaProvider } from './providers/VaultCaProvider';
import {
  computeOpenSshFingerprint,
  parseOpenSshCertificate,
  validateOpenSshCertificate,
} from './sshCertificateUtils';
import { exportSshWirePublicKey, type SshWireKeyInfo } from './sshPublicKeyFormat';
import {
  buildRedirectUri,
  generatePkce,
  generateState,
  startCallbackServer,
} from '../oauth/loopbackAuth';
import { requestJson } from '../oauth/requestJson';
import { createLogger } from '../log';

const caLog = createLogger('ssh-ca-service');

export interface SshCaServiceDependencies {
  appAgent: AppAgent;
  openExternal?: (url: string) => Promise<void>;
  providers?: Map<SshCaBackendType, ISshCaProvider>;
  getSettings?: () => Promise<AppSettings>;
  saveSettings?: (settings: Partial<AppSettings>) => Promise<AppSettings>;
  getPivPublicKey?: () => Promise<SshWireKeyInfo | null>;
}

interface ActiveSession {
  config: SshCaConfig;
  username: string;
  principals: string[];
  parsedCert: SshCaCertificateInfo;
  certFingerprint: string;
  certificateFilePath?: string;
  refreshToken?: string;
  tokenEndpoint?: string;
}

export class SshCaService {
  private readonly deps: SshCaServiceDependencies;
  private readonly providers: Map<SshCaBackendType, ISshCaProvider>;
  private activeSession: ActiveSession | null = null;
  private statusListeners = new Set<(status: SshCaStatus) => void>();
  private expirationTimer: NodeJS.Timeout | null = null;
  private renewalTimer: NodeJS.Timeout | null = null;

  constructor(deps: SshCaServiceDependencies) {
    this.deps = deps;
    this.providers = deps.providers ?? new Map<SshCaBackendType, ISshCaProvider>([
      ['step-ca', new StepCaProvider()],
      ['vault', new VaultCaProvider()],
    ]);
  }

  public getStatus(): SshCaStatus {
    if (!this.activeSession) {
      return { active: false };
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const validBeforeMs = new Date(this.activeSession.parsedCert.validBefore).getTime();
    const validBeforeSec = Math.floor(validBeforeMs / 1000);
    const validSecondsRemaining = Math.max(0, validBeforeSec - nowSec);

    if (validSecondsRemaining === 0) {
      return {
        active: false,
        configId: this.activeSession.config.id,
        username: this.activeSession.username,
        principals: this.activeSession.principals,
        expiresAt: this.activeSession.parsedCert.validBefore,
        validSecondsRemaining: 0,
        error: 'Certificate expired',
      };
    }

    const cert = this.activeSession.parsedCert;
    const certInfo: SshCaCertificateInfo = {
      certType: cert.certType,
      keyId: cert.keyId,
      principals: cert.principals,
      validAfter: cert.validAfter,
      validBefore: cert.validBefore,
      serial: cert.serial,
      signatureKeyFingerprint: cert.signatureKeyFingerprint,
      publicKeyFingerprint: cert.publicKeyFingerprint,
    };

    return {
      active: true,
      configId: this.activeSession.config.id,
      username: this.activeSession.username,
      principals: this.activeSession.principals,
      expiresAt: certInfo.validBefore,
      validSecondsRemaining,
      certInfo,
      certificateFilePath: this.activeSession.certificateFilePath,
    };
  }

  public getActiveCertificateFilePath(): string | undefined {
    return this.activeSession?.certificateFilePath;
  }

  public onStatusChanged(listener: (status: SshCaStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  private notifyStatus(): void {
    const status = this.getStatus();
    for (const listener of this.statusListeners) {
      try {
        listener(status);
      } catch (err) {
        caLog.error('Error notifying SSH CA status listener:', (err as Error).message);
      }
    }
  }

  public async login(config?: SshCaConfig, signal?: AbortSignal): Promise<SshCaStatus> {
    const activeConfig = config ?? (await this.resolveDefaultConfig());
    if (!activeConfig) {
      throw new Error('No SSH CA configuration provided or configured in settings');
    }

    caLog.info(`Initiating login for SSH CA config "${activeConfig.name}" (${activeConfig.id})`);

    let preloadedPivKey: SshWireKeyInfo | undefined;
    if (activeConfig.keySource === 'piv') {
      if (!this.deps.getPivPublicKey) {
        throw new Error('PIV hardware token key source is not supported in this environment');
      }
      const pivKey = await this.deps.getPivPublicKey();
      if (!pivKey) {
        throw new Error('No YubiKey PIV card detected. Please insert your YubiKey and ensure the PIV module is loaded.');
      }
      preloadedPivKey = pivKey;
    }

    const issuer = activeConfig.oidcIssuerUrl.trim().replace(/\/+$/, '');
    const isLoopback = issuer.startsWith('http://127.0.0.1') || issuer.startsWith('http://localhost');
    const discoveryUrl = `${issuer}/.well-known/openid-configuration`;
    const rootCa = activeConfig.rootCaCert?.trim()
      ? Buffer.from(activeConfig.rootCaCert.trim(), 'utf-8')
      : undefined;

    const discRes = await requestJson(discoveryUrl, {
      method: 'GET',
      ca: rootCa,
      timeoutMs: 15_000,
      allowHttp: isLoopback,
    });

    if (discRes.statusCode !== 200) {
      throw new Error(`Failed to fetch OIDC discovery configuration from ${discoveryUrl} (HTTP ${discRes.statusCode})`);
    }

    const discovery = discRes.json as {
      authorization_endpoint?: string;
      token_endpoint?: string;
    };

    if (!discovery.authorization_endpoint || !discovery.token_endpoint) {
      throw new Error('OIDC discovery response missing authorization_endpoint or token_endpoint');
    }

    const pkce = generatePkce();
    const state = generateState();
    const nonce = crypto.randomBytes(16).toString('base64url');

    const callbackServer = await startCallbackServer({
      state,
      signal: signal ?? new AbortController().signal,
      timeoutMs: 120_000,
      providerName: 'SSH CA',
    });

    const redirectUri = buildRedirectUri(callbackServer.host, callbackServer.port);

    const authUrl = new URL(discovery.authorization_endpoint);
    authUrl.searchParams.set('client_id', activeConfig.oidcClientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', 'openid profile email');
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('code_challenge', pkce.challenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    authUrl.searchParams.set('nonce', nonce);

    const openBrowser = this.deps.openExternal ?? (async (targetUrl: string) => {
      const { shell } = await import('electron');
      await shell.openExternal(targetUrl);
    });

    await openBrowser(authUrl.toString());

    let code: string;
    try {
      code = await callbackServer.waitForCode();
    } finally {
      callbackServer.close();
    }

    const tokenParams = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: activeConfig.oidcClientId,
      code,
      redirect_uri: redirectUri,
      code_verifier: pkce.verifier,
    });

    const tokenRes = await requestJson(discovery.token_endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: tokenParams.toString(),
      ca: rootCa,
      timeoutMs: 15_000,
      allowHttp: isLoopback,
    });

    if (tokenRes.statusCode !== 200) {
      const errBody = tokenRes.json as { error_description?: string; error?: string } | undefined;
      const desc = errBody?.error_description || errBody?.error || `HTTP ${tokenRes.statusCode}`;
      throw new Error(`OIDC token exchange failed: ${desc}`);
    }

    const tokenData = tokenRes.json as {
      id_token?: string;
      access_token?: string;
      refresh_token?: string;
    };

    if (!tokenData.id_token) {
      throw new Error('OIDC token endpoint did not return an id_token');
    }

    const username = this.extractUsernameFromIdToken(tokenData.id_token);

    await this.signAndLoadCertificate({
      config: activeConfig,
      idToken: tokenData.id_token,
      refreshToken: tokenData.refresh_token,
      tokenEndpoint: discovery.token_endpoint,
      username,
      pivKey: preloadedPivKey,
      signal,
    });

    return this.getStatus();
  }

  public async logout(): Promise<void> {
    this.clearTimers();

    if (this.activeSession) {
      if (this.activeSession.certificateFilePath) {
        try {
          await fs.promises.unlink(this.activeSession.certificateFilePath);
        } catch {
          // Non-fatal
        }
      }
      try {
        await this.deps.appAgent.removeIdentities([this.activeSession.certFingerprint]);
      } catch (err) {
        caLog.warn('Failed to evict certificate from ssh-agent during logout:', (err as Error).message);
      }
      this.activeSession = null;
    }

    this.notifyStatus();
  }

  public async renew(signal?: AbortSignal): Promise<SshCaStatus> {
    if (!this.activeSession) {
      throw new Error('No active SSH CA session to renew');
    }

    const session = this.activeSession;
    if (session.refreshToken && session.tokenEndpoint) {
      try {
        caLog.info(`Attempting token refresh for SSH CA session "${session.username}"`);
        const rootCa = session.config.rootCaCert?.trim()
          ? Buffer.from(session.config.rootCaCert.trim(), 'utf-8')
          : undefined;

        const refreshParams = new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: session.config.oidcClientId,
          refresh_token: session.refreshToken,
        });

        const isLoopback = session.tokenEndpoint.startsWith('http://127.0.0.1') || session.tokenEndpoint.startsWith('http://localhost');
        const tokenRes = await requestJson(session.tokenEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: refreshParams.toString(),
          ca: rootCa,
          timeoutMs: 15_000,
          allowHttp: isLoopback,
        });

        if (tokenRes.statusCode === 200) {
          const tokenData = tokenRes.json as {
            id_token?: string;
            refresh_token?: string;
          };

          if (tokenData.id_token) {
            await this.signAndLoadCertificate({
              config: session.config,
              idToken: tokenData.id_token,
              refreshToken: tokenData.refresh_token ?? session.refreshToken,
              tokenEndpoint: session.tokenEndpoint,
              username: session.username,
              signal,
            });
            return this.getStatus();
          }
        }
      } catch (err) {
        caLog.warn('Token refresh failed, falling back to interactive login:', (err as Error).message);
      }
    }

    // Fall back to full interactive login with saved config
    return this.login(session.config, signal);
  }

  private async signAndLoadCertificate(params: {
    config: SshCaConfig;
    idToken: string;
    refreshToken?: string;
    tokenEndpoint?: string;
    username: string;
    pivKey?: SshWireKeyInfo;
    signal?: AbortSignal;
  }): Promise<void> {
    const { config, idToken, refreshToken, tokenEndpoint, username, signal } = params;

    let publicKeyWireBase64: string;
    let keyType: string;
    let publicKeyLine: string;
    let pubKey: Buffer | undefined;
    let privSeed: Buffer | undefined;

    if (config.keySource === 'piv') {
      const pivKey = params.pivKey ?? (await this.deps.getPivPublicKey?.());
      if (!pivKey) {
        throw new Error('No YubiKey PIV card detected. Please insert your YubiKey and ensure the PIV module is loaded.');
      }
      publicKeyWireBase64 = pivKey.wireBase64;
      keyType = pivKey.keyType;
      publicKeyLine = pivKey.publicKeyLine;
    } else {
      // Generate ephemeral Ed25519 keypair in memory
      const keyPair = crypto.generateKeyPairSync('ed25519');
      const pkcs8 = keyPair.privateKey.export({ type: 'pkcs8', format: 'der' });
      privSeed = pkcs8.subarray(pkcs8.length - 32);

      const keyInfo = exportSshWirePublicKey(keyPair.publicKey, `sshs3-ca:${username}`);
      publicKeyWireBase64 = keyInfo.wireBase64;
      keyType = keyInfo.keyType;
      publicKeyLine = keyInfo.publicKeyLine;
      const spki = keyPair.publicKey.export({ type: 'spki', format: 'der' });
      pubKey = spki.subarray(spki.length - 32);
    }

    const provider = this.providers.get(config.backend);
    if (!provider) {
      throw new Error(`Unsupported SSH CA backend: ${config.backend}`);
    }

    const signRes = await provider.sign(
      {
        publicKeyWireBase64,
        keyType,
        publicKeyLine,
        identityToken: idToken,
        username,
        principals: config.defaultPrincipals,
      },
      config,
      signal ?? new AbortController().signal
    );

    const certWire = Buffer.from(signRes.certificateWireBase64, 'base64');
    const parsedCert = parseOpenSshCertificate(certWire);
    const validation = validateOpenSshCertificate(parsedCert);
    if (!validation.valid) {
      throw new Error(`SSH CA issued invalid certificate: ${validation.error}`);
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const validBeforeMs = new Date(parsedCert.validBefore).getTime();
    const validBeforeSec = Math.floor(validBeforeMs / 1000);
    const lifetimeSeconds = Math.max(0, validBeforeSec - nowSec);

    // Evict previous certificate from agent or disk if replacing an active session
    if (this.activeSession) {
      if (this.activeSession.certificateFilePath) {
        try {
          await fs.promises.unlink(this.activeSession.certificateFilePath);
        } catch {
          // Non-fatal
        }
      }
      try {
        await this.deps.appAgent.removeIdentities([this.activeSession.certFingerprint]);
      } catch {
        // Non-fatal
      }
    }

    let certificateFilePath: string | undefined;

    if (config.keySource === 'piv') {
      const certsDir = path.join(resolveAppAgentDir(), 'certs');
      await ensureSecureDir(certsDir);
      const safeFp = parsedCert.publicKeyFingerprint.replace(/[^a-zA-Z0-9_-]/g, '_');
      certificateFilePath = path.join(certsDir, `${safeFp}-cert.pub`);
      await fs.promises.writeFile(certificateFilePath, signRes.certificateLine + '\n', { mode: 0o600 });
      caLog.info(`Saved PIV SSH CA certificate to ${certificateFilePath}`);
    } else {
      // Load new certificate into the app-managed SSH agent
      await this.deps.appAgent.addCertifiedEd25519Key({
        certificateWire: certWire,
        publicKeyBytes: pubKey!,
        privateKeySeedBytes: privSeed!,
        comment: `sshs3-ca:${username}`,
        lifetimeSeconds: lifetimeSeconds > 0 ? lifetimeSeconds : undefined,
      });
    }

    this.activeSession = {
      config,
      username,
      principals: parsedCert.principals,
      parsedCert,
      certFingerprint: computeOpenSshFingerprint(certWire),
      certificateFilePath,
      refreshToken,
      tokenEndpoint,
    };

    this.scheduleTimers(validBeforeSec, refreshToken !== undefined);
    this.notifyStatus();
  }

  private scheduleTimers(validBeforeSec: number, hasRefreshToken: boolean): void {
    this.clearTimers();

    const nowMs = Date.now();
    const expiryMs = validBeforeSec * 1000;
    const remainingMs = expiryMs - nowMs;

    if (remainingMs <= 0) {
      this.notifyStatus();
      return;
    }

    // Node.js setTimeout clamps delay to 32-bit signed int (max ~24.8 days); prevent overflow warning & 1ms trigger
    const MAX_TIMEOUT_MS = 2_147_483_647;

    // Set expiration timer
    this.expirationTimer = setTimeout(() => {
      caLog.info('SSH CA certificate expired');
      this.notifyStatus();
    }, Math.min(remainingMs, MAX_TIMEOUT_MS));

    // If a refresh token is present, schedule automatic renewal 60 seconds before expiry
    if (hasRefreshToken && remainingMs > 75_000) {
      const renewInMs = remainingMs - 60_000;
      this.renewalTimer = setTimeout(async () => {
        caLog.info('Triggering automatic SSH CA certificate renewal before expiry');
        try {
          await this.renew();
        } catch (err) {
          caLog.warn('Automatic SSH CA renewal failed:', (err as Error).message);
        }
      }, Math.min(renewInMs, MAX_TIMEOUT_MS));
    }
  }

  private clearTimers(): void {
    if (this.expirationTimer) {
      clearTimeout(this.expirationTimer);
      this.expirationTimer = null;
    }
    if (this.renewalTimer) {
      clearTimeout(this.renewalTimer);
      this.renewalTimer = null;
    }
  }

  private extractUsernameFromIdToken(idToken: string): string {
    const parts = idToken.split('.');
    if (parts.length < 2) {
      return 'user';
    }
    try {
      const claimsJson = Buffer.from(parts[1], 'base64url').toString('utf-8');
      const claims = JSON.parse(claimsJson) as Record<string, unknown>;
      return (
        (claims.preferred_username as string) ||
        (claims.email as string) ||
        (claims.sub as string) ||
        'user'
      );
    } catch {
      return 'user';
    }
  }

  private async resolveDefaultConfig(): Promise<SshCaConfig | null> {
    if (!this.deps.getSettings) return null;
    const settings = await this.deps.getSettings();
    const configs = settings.sshCaConfigs;
    if (!configs || configs.length === 0) return null;

    if (settings.defaultSshCaConfigId) {
      const found = configs.find((c) => c.id === settings.defaultSshCaConfigId);
      if (found) return found;
    }

    return configs[0];
  }
}
