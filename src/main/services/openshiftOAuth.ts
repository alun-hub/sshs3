import crypto from 'node:crypto';

/**
 * Pure helpers for the OpenShift browser sign-in (OAuth 2.0 authorization code
 * grant with PKCE against the built-in OAuth server). They mirror what
 * `oc login --web` does (openshift/library-go `pkg/oauth/tokenrequest`), so the
 * flow stays compatible with the server side without any I/O in this file.
 */

/** Public OAuth client that the cluster-authentication-operator registers (OpenShift 4.13+). */
export const OPENSHIFT_CLI_CLIENT_ID = 'openshift-cli-client';

/** Unauthenticated OAuth 2.0 Authorization Server Metadata document of the OpenShift OAuth server. */
export const OAUTH_METADATA_PATH = '/.well-known/oauth-authorization-server';

/** The client is registered with `http://127.0.0.1/callback` and `http://[::1]/callback`; the server ignores the port. */
export const CALLBACK_PATH = '/callback';

export interface OAuthMetadata {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  /** PKCE is only used when the server advertises S256 (same rule as `oc`). */
  supportsS256: boolean;
}

export interface PkcePair {
  verifier: string;
  challenge: string;
}

export interface TokenResult {
  accessToken: string;
  /** ISO timestamp, only when the server reported `expires_in`. */
  expiresAt?: string;
}

const MAX_ERROR_TEXT = 200;

function base64Url(buf: Buffer): string {
  return buf.toString('base64url');
}

function sanitizeServerText(value: string): string {
  // eslint-disable-next-line no-control-regex -- strips control characters from server-provided text before it reaches the UI
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, MAX_ERROR_TEXT);
}

function normalizeServer(server: string): URL {
  let normalized = server.trim();
  if (!/^https?:\/\//i.test(normalized)) {
    normalized = `https://${normalized}`;
  }
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error(`Invalid cluster URL: ${server}`);
  }
  return parsed;
}

export function buildMetadataUrl(server: string): string {
  const parsed = normalizeServer(server);
  return new URL(OAUTH_METADATA_PATH, `${parsed.protocol}//${parsed.host}`).toString();
}

function requireEndpoint(value: unknown, name: string, allowHttp: boolean): string {
  if (typeof value !== 'string' || !value) {
    throw new Error(`OAuth metadata is missing ${name}`);
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`OAuth metadata has an invalid ${name}`);
  }
  if (parsed.protocol !== 'https:' && !(allowHttp && parsed.protocol === 'http:')) {
    throw new Error(`OAuth metadata ${name} must use https`);
  }
  return parsed.toString();
}

/** Fails closed: every required field must be present and the endpoints must be https. */
export function parseOAuthMetadata(raw: unknown, options: { allowHttp?: boolean } = {}): OAuthMetadata {
  if (!raw || typeof raw !== 'object') {
    throw new Error('OAuth metadata is not a JSON object');
  }
  const doc = raw as Record<string, unknown>;
  const allowHttp = options.allowHttp === true;
  if (typeof doc.issuer !== 'string' || !doc.issuer) {
    throw new Error('OAuth metadata is missing issuer');
  }
  const methods = Array.isArray(doc.code_challenge_methods_supported) ? doc.code_challenge_methods_supported : [];
  return {
    issuer: doc.issuer,
    authorizationEndpoint: requireEndpoint(doc.authorization_endpoint, 'authorization_endpoint', allowHttp),
    tokenEndpoint: requireEndpoint(doc.token_endpoint, 'token_endpoint', allowHttp),
    supportsS256: methods.includes('S256'),
  };
}

/** 96 random bytes as base64url (128 characters), challenge = base64url(SHA-256(verifier)). */
export function generatePkce(): PkcePair {
  const verifier = base64Url(crypto.randomBytes(96));
  const challenge = base64Url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

export function generateState(): string {
  return base64Url(crypto.randomBytes(32));
}

export function buildRedirectUri(host: '127.0.0.1' | '::1', port: number): string {
  const hostPart = host === '::1' ? '[::1]' : host;
  return `http://${hostPart}:${port}${CALLBACK_PATH}`;
}

export function buildAuthorizeUrl(
  metadata: OAuthMetadata,
  params: { redirectUri: string; state: string; challenge?: string }
): string {
  const url = new URL(metadata.authorizationEndpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', OPENSHIFT_CLI_CLIENT_ID);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('state', params.state);
  if (params.challenge) {
    url.searchParams.set('code_challenge', params.challenge);
    url.searchParams.set('code_challenge_method', 'S256');
  }
  return url.toString();
}

export type CallbackOutcome =
  | { kind: 'code'; code: string }
  | { kind: 'error'; message: string }
  | { kind: 'state-mismatch' };

function statesEqual(actual: string | null, expected: string): boolean {
  if (actual === null) return false;
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Interprets the browser's redirect to `/callback`. A wrong or missing `state`
 * is reported separately so the caller can keep waiting for the real callback
 * instead of letting any local process abort the sign-in.
 */
export function parseCallback(search: string, expectedState: string): CallbackOutcome {
  const params = new URLSearchParams(search);
  if (!statesEqual(params.get('state'), expectedState)) {
    return { kind: 'state-mismatch' };
  }
  const error = params.get('error');
  if (error) {
    const description = params.get('error_description');
    const text = sanitizeServerText(description ? `${error}: ${description}` : error);
    return { kind: 'error', message: `OpenShift sign-in was rejected (${text})` };
  }
  const code = params.get('code');
  if (!code) {
    return { kind: 'error', message: 'OpenShift sign-in did not return an authorization code' };
  }
  return { kind: 'code', code };
}

/**
 * Token request as `oc` sends it: form body, the public client authenticates
 * with HTTP Basic `client_id:` (empty secret), `code_verifier` only with PKCE.
 */
export function buildTokenRequest(params: { code: string; redirectUri: string; verifier?: string }): {
  body: string;
  authorization: string;
} {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: params.code,
    redirect_uri: params.redirectUri,
  });
  if (params.verifier) {
    body.set('code_verifier', params.verifier);
  }
  return {
    body: body.toString(),
    authorization: `Basic ${Buffer.from(`${OPENSHIFT_CLI_CLIENT_ID}:`).toString('base64')}`,
  };
}

export function parseTokenResponse(raw: unknown, now: number = Date.now()): TokenResult {
  if (!raw || typeof raw !== 'object') {
    throw new Error('OpenShift token endpoint returned an unexpected response');
  }
  const doc = raw as Record<string, unknown>;
  if (typeof doc.error === 'string' && doc.error) {
    const description = typeof doc.error_description === 'string' ? `: ${doc.error_description}` : '';
    throw new Error(`OpenShift token request failed (${sanitizeServerText(`${doc.error}${description}`)})`);
  }
  const accessToken = typeof doc.access_token === 'string' ? doc.access_token.trim() : '';
  if (!accessToken) {
    throw new Error('OpenShift token endpoint did not return an access token');
  }
  if (typeof doc.token_type === 'string' && doc.token_type.toLowerCase() !== 'bearer') {
    throw new Error('OpenShift token endpoint returned an unsupported token type');
  }
  const result: TokenResult = { accessToken };
  if (typeof doc.expires_in === 'number' && Number.isFinite(doc.expires_in) && doc.expires_in > 0) {
    result.expiresAt = new Date(now + doc.expires_in * 1000).toISOString();
  }
  return result;
}
