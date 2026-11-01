import { requestJson } from '../../oauth/requestJson';
import { isLoopbackHttpUrl } from '../loopbackUrl';
import type { ISshCaProvider, SshCaConfig, SshCaSignRequest, SshCaSignResponse } from '../../../shared/types/sshCa';

export class VaultCaProvider implements ISshCaProvider {
  public readonly id = 'vault' as const;

  public async sign(
    request: SshCaSignRequest,
    config: SshCaConfig,
    signal?: AbortSignal
  ): Promise<SshCaSignResponse> {
    if (!config.caUrl?.trim()) {
      throw new Error('Vault CA URL is required');
    }
    if (!request.identityToken?.trim()) {
      throw new Error('OIDC identity token is required for Vault authentication');
    }
    if (!request.publicKeyLine?.trim()) {
      throw new Error('Public key line is required for Vault SSH signing');
    }

    let caBaseUrl = config.caUrl.trim();
    if (!caBaseUrl.startsWith('http://') && !caBaseUrl.startsWith('https://')) {
      caBaseUrl = `https://${caBaseUrl}`;
    }
    const baseUrl = caBaseUrl.replace(/\/+$/, '');
    const isLoopback = isLoopbackHttpUrl(baseUrl);
    const rootCa = config.rootCaCert?.trim() ? Buffer.from(config.rootCaCert.trim(), 'utf8') : undefined;

    const baseHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (config.vaultNamespace?.trim()) {
      baseHeaders['X-Vault-Namespace'] = config.vaultNamespace.trim();
    }

    // Step 1: Authenticate to Vault using OIDC identity token (JWT)
    const authMount = (config.vaultAuthPath?.trim() || 'jwt').replace(/^\/+|\/+$/g, '');
    const authRole = config.vaultRole?.trim() || 'default';
    const loginUrl = `${baseUrl}/v1/auth/${authMount}/login`;

    const loginRes = await requestJson(loginUrl, {
      method: 'POST',
      headers: baseHeaders,
      body: JSON.stringify({
        role: authRole,
        jwt: request.identityToken,
      }),
      ca: rootCa,
      timeoutMs: 15_000,
      allowHttp: isLoopback,
    });

    if (signal?.aborted) {
      throw new Error('Vault request was cancelled');
    }

    if (loginRes.statusCode !== 200) {
      const errObj = loginRes.json as { errors?: string[] } | undefined;
      const errMsg = Array.isArray(errObj?.errors) && errObj.errors.length > 0
        ? errObj.errors.join(', ')
        : `HTTP ${loginRes.statusCode}`;
      throw new Error(`Vault OIDC login failed: ${errMsg}`);
    }

    const authData = (loginRes.json as { auth?: { client_token?: string } })?.auth;
    const clientToken = authData?.client_token?.trim();
    if (!clientToken) {
      throw new Error('Vault login did not return a client_token');
    }

    // Step 2: Sign the SSH public key using Vault SSH secrets engine
    const sshMount = (config.vaultSshMount?.trim() || 'ssh').replace(/^\/+|\/+$/g, '');
    const sshRole = (config.vaultSshRole?.trim() || config.vaultRole?.trim() || 'client').replace(/^\/+|\/+$/g, '');
    const signUrl = `${baseUrl}/v1/${sshMount}/sign/${sshRole}`;

    const signPayload: Record<string, unknown> = {
      public_key: request.publicKeyLine.trim(),
      cert_type: 'user',
    };
    if (request.principals && request.principals.length > 0) {
      signPayload.valid_principals = request.principals.join(',');
    }
    if (request.ttlSeconds && request.ttlSeconds > 0) {
      signPayload.ttl = `${request.ttlSeconds}s`;
    }

    let signRes;
    try {
      signRes = await requestJson(signUrl, {
        method: 'POST',
        headers: {
          ...baseHeaders,
          'X-Vault-Token': clientToken,
        },
        body: JSON.stringify(signPayload),
        ca: rootCa,
        timeoutMs: 15_000,
        allowHttp: isLoopback,
      });
    } finally {
      // Step 3: Revoke single-use Vault client token after signing (best-effort cleanup)
      try {
        await requestJson(`${baseUrl}/v1/auth/token/revoke-self`, {
          method: 'POST',
          headers: {
            ...baseHeaders,
            'X-Vault-Token': clientToken,
          },
          ca: rootCa,
          timeoutMs: 5_000,
          allowHttp: isLoopback,
        });
      } catch {
        // Non-fatal, token expiration will handle cleanup if revoke-self is disallowed
      }
    }

    if (signal?.aborted) {
      throw new Error('Vault request was cancelled');
    }

    if (signRes.statusCode !== 200 && signRes.statusCode !== 201) {
      const errObj = signRes.json as { errors?: string[] } | undefined;
      const errMsg = Array.isArray(errObj?.errors) && errObj.errors.length > 0
        ? errObj.errors.join(', ')
        : `HTTP ${signRes.statusCode}`;
      throw new Error(`Vault SSH key signing failed: ${errMsg}`);
    }

    const data = (signRes.json as { data?: { signed_key?: string } })?.data;
    const signedKey = data?.signed_key?.trim();
    if (!signedKey) {
      throw new Error('Vault SSH response did not contain "signed_key"');
    }

    const parts = signedKey.split(/\s+/);
    let certificateWireBase64: string;
    let certificateLine: string;

    if (parts.length >= 2) {
      certificateWireBase64 = parts[1];
      certificateLine = signedKey;
    } else {
      certificateWireBase64 = parts[0];
      const certType = request.keyType.endsWith('-cert-v01@openssh.com')
        ? request.keyType
        : `${request.keyType}-cert-v01@openssh.com`;
      certificateLine = `${certType} ${certificateWireBase64} sshs3-ca:${request.username}`;
    }

    return {
      certificateWireBase64,
      certificateLine,
    };
  }
}
