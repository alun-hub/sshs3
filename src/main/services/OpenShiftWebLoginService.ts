import http from 'node:http';
import https from 'node:https';
import type { AddressInfo } from 'node:net';
import {
  CALLBACK_PATH,
  buildAuthorizeUrl,
  buildMetadataUrl,
  buildRedirectUri,
  buildTokenRequest,
  generatePkce,
  generateState,
  parseCallback,
  parseOAuthMetadata,
  parseTokenResponse,
  type OAuthMetadata,
} from './openshiftOAuth';
import type { K8sOpenShiftProbeResult } from '../../shared/types/kubernetes';

const DEFAULT_CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 1024 * 1024;

export const BROWSER_SIGN_IN_UNSUPPORTED =
  'This cluster does not expose an OpenShift OAuth server. Browser sign-in needs OpenShift 4.13 or newer with the built-in OAuth server; paste a login command instead.';

const CERT_ERROR_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

export class OpenShiftWebLoginCancelledError extends Error {
  constructor() {
    super('OpenShift browser sign-in was cancelled');
    this.name = 'OpenShiftWebLoginCancelledError';
  }
}

export interface OpenShiftWebLoginServiceOptions {
  /** Test seam: lets the mock OAuth server speak plain http. Never set in the app. */
  allowHttp?: boolean;
  callbackTimeoutMs?: number;
  requestTimeoutMs?: number;
}

export interface OpenShiftWebLoginRequest {
  server: string;
  insecureSkipTlsVerify?: boolean;
  callbackPort?: number;
}

export interface OpenShiftWebLoginHooks {
  /** Called once with the authorization URL the user must open in a browser. */
  onAuthorizeUrl: (url: string) => void;
  signal?: AbortSignal;
}

interface JsonResponse {
  statusCode: number;
  json: unknown;
}

interface CallbackServer {
  host: '127.0.0.1' | '::1';
  port: number;
  waitForCode: () => Promise<string>;
  close: () => void;
}

function describeNetworkError(host: string, err: NodeJS.ErrnoException): Error {
  const hint = err.code && CERT_ERROR_CODES.has(err.code)
    ? ' Enable "Skip TLS certificate verification" if the cluster uses a private CA.'
    : '';
  return new Error(`Could not reach ${host}: ${err.message}.${hint}`);
}

function requestJson(
  urlString: string,
  init: {
    method: 'GET' | 'POST';
    headers?: Record<string, string>;
    body?: string;
    insecureSkipTlsVerify?: boolean;
    timeoutMs: number;
    allowHttp: boolean;
  }
): Promise<JsonResponse> {
  return new Promise((resolve, reject) => {
    let url: URL;
    try {
      url = new URL(urlString);
    } catch {
      reject(new Error('Invalid URL'));
      return;
    }
    const isHttps = url.protocol === 'https:';
    if (!isHttps && !(init.allowHttp && url.protocol === 'http:')) {
      reject(new Error('Only https URLs are allowed'));
      return;
    }
    const client = isHttps ? https : http;
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': 'sshs3-client',
      ...init.headers,
    };
    if (init.body !== undefined) {
      headers['Content-Length'] = String(Buffer.byteLength(init.body));
    }
    const req = client.request(
      url,
      {
        method: init.method,
        headers,
        rejectUnauthorized: !init.insecureSkipTlsVerify,
        timeout: init.timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_RESPONSE_BYTES) {
            req.destroy(new Error('Response too large'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          let json: unknown;
          try {
            json = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          } catch {
            json = undefined;
          }
          resolve({ statusCode: res.statusCode ?? 0, json });
        });
        res.on('error', reject);
      }
    );
    req.on('timeout', () => req.destroy(new Error('Request timed out')));
    req.on('error', (err: NodeJS.ErrnoException) => reject(describeNetworkError(url.host, err)));
    if (init.body !== undefined) req.write(init.body);
    req.end();
  });
}

function listenOn(server: http.Server, host: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (err: Error) => {
      server.removeListener('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      server.removeListener('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

function respond(res: http.ServerResponse, status: number, text: string): void {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(text);
}

/**
 * Starts the loopback server that receives the browser redirect. It accepts
 * exactly one valid callback, ignores anything with a wrong `state` (so a stray
 * local request cannot abort the sign-in) and never reflects request data.
 */
async function startCallbackServer(
  requestedPort: number | undefined,
  state: string,
  signal: AbortSignal,
  timeoutMs: number
): Promise<CallbackServer> {
  let hostLabel = '127.0.0.1';
  let settled = false;
  let resolveCode!: (code: string) => void;
  let rejectCode!: (err: Error) => void;
  const codePromise = new Promise<string>((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });
  // The flow may be aborted before anyone awaits the promise; avoid an unhandled rejection.
  codePromise.catch(() => {});

  const server = http.createServer((req, res) => {
    let url: URL;
    try {
      url = new URL(req.url ?? '/', 'http://127.0.0.1');
    } catch {
      respond(res, 400, 'Bad request.');
      return;
    }
    if (req.method !== 'GET' || url.pathname !== CALLBACK_PATH) {
      respond(res, 404, 'Not found.');
      return;
    }
    const address = server.address() as AddressInfo | null;
    if (!address || req.headers.host !== `${hostLabel}:${address.port}`) {
      respond(res, 400, 'Bad request.');
      return;
    }
    if (settled) {
      respond(res, 410, 'This sign-in has already been handled.');
      return;
    }
    const outcome = parseCallback(url.search, state);
    if (outcome.kind === 'state-mismatch') {
      respond(res, 400, 'Invalid sign-in response.');
      return;
    }
    settled = true;
    if (outcome.kind === 'error') {
      respond(res, 400, 'Sign-in failed. Return to sshs3 for details.');
      rejectCode(new Error(outcome.message));
      return;
    }
    respond(res, 200, 'Sign-in complete. You can close this tab and return to sshs3.');
    resolveCode(outcome.code);
  });

  let host: '127.0.0.1' | '::1' = '127.0.0.1';
  try {
    await listenOn(server, host, requestedPort ?? 0);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EADDRNOTAVAIL' || code === 'EAFNOSUPPORT') {
      host = '::1';
      hostLabel = '[::1]';
      await listenOn(server, host, requestedPort ?? 0);
    } else if (code === 'EADDRINUSE') {
      throw new Error(`Port ${requestedPort} is already in use. Choose another callback port.`, { cause: err });
    } else {
      throw err;
    }
  }

  const timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    rejectCode(
      new Error(
        'Timed out waiting for the browser sign-in. If the browser showed an error, the cluster may not support browser sign-in (OpenShift 4.13 or newer is required).'
      )
    );
  }, timeoutMs);
  const onAbort = () => {
    if (settled) return;
    settled = true;
    rejectCode(new OpenShiftWebLoginCancelledError());
  };
  if (signal.aborted) onAbort();
  else signal.addEventListener('abort', onAbort, { once: true });

  const port = (server.address() as AddressInfo).port;
  return {
    host,
    port,
    waitForCode: () => codePromise,
    close: () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      server.close();
      setTimeout(() => server.closeAllConnections?.(), 1000).unref();
    },
  };
}

/**
 * OpenShift browser sign-in: the same authorization code + PKCE flow as
 * `oc login --web`. It only produces an access token; storing it in the
 * kubeconfig is left to `loginWithToken`, so both sign-in paths share validation.
 */
export class OpenShiftWebLoginService {
  private active: AbortController | null = null;

  constructor(private readonly options: OpenShiftWebLoginServiceOptions = {}) {}

  private get allowHttp(): boolean {
    return this.options.allowHttp === true;
  }

  private get requestTimeoutMs(): number {
    return this.options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  private async fetchMetadata(server: string, insecureSkipTlsVerify?: boolean): Promise<OAuthMetadata> {
    const res = await requestJson(buildMetadataUrl(server), {
      method: 'GET',
      insecureSkipTlsVerify,
      timeoutMs: this.requestTimeoutMs,
      allowHttp: this.allowHttp,
    });
    if (res.statusCode !== 200 || res.json === undefined) {
      throw new Error(BROWSER_SIGN_IN_UNSUPPORTED);
    }
    return parseOAuthMetadata(res.json, { allowHttp: this.allowHttp });
  }

  /** Never throws: any failure to discover the OAuth server means "not supported". */
  async probe(server: string, insecureSkipTlsVerify?: boolean): Promise<K8sOpenShiftProbeResult> {
    try {
      await this.fetchMetadata(server, insecureSkipTlsVerify);
      return { supported: true };
    } catch (err) {
      return { supported: false, reason: err instanceof Error ? err.message : String(err) };
    }
  }

  cancel(): void {
    this.active?.abort();
  }

  async login(
    request: OpenShiftWebLoginRequest,
    hooks: OpenShiftWebLoginHooks
  ): Promise<{ token: string; expiresAt?: string }> {
    this.cancel();
    const controller = new AbortController();
    this.active = controller;
    const onExternalAbort = () => controller.abort();
    if (hooks.signal?.aborted) controller.abort();
    else hooks.signal?.addEventListener('abort', onExternalAbort, { once: true });

    const throwIfCancelled = () => {
      if (controller.signal.aborted) throw new OpenShiftWebLoginCancelledError();
    };

    let callbackServer: CallbackServer | undefined;
    try {
      const metadata = await this.fetchMetadata(request.server, request.insecureSkipTlsVerify);
      throwIfCancelled();

      const pkce = metadata.supportsS256 ? generatePkce() : undefined;
      const state = generateState();
      callbackServer = await startCallbackServer(
        request.callbackPort,
        state,
        controller.signal,
        this.options.callbackTimeoutMs ?? DEFAULT_CALLBACK_TIMEOUT_MS
      );

      const redirectUri = buildRedirectUri(callbackServer.host, callbackServer.port);
      hooks.onAuthorizeUrl(buildAuthorizeUrl(metadata, { redirectUri, state, challenge: pkce?.challenge }));
      const code = await callbackServer.waitForCode();
      throwIfCancelled();

      const tokenRequest = buildTokenRequest({ code, redirectUri, verifier: pkce?.verifier });
      const res = await requestJson(metadata.tokenEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: tokenRequest.authorization,
        },
        body: tokenRequest.body,
        insecureSkipTlsVerify: request.insecureSkipTlsVerify,
        timeoutMs: this.requestTimeoutMs,
        allowHttp: this.allowHttp,
      });
      if (res.statusCode !== 200 && res.json === undefined) {
        throw new Error(`OpenShift token request failed (HTTP ${res.statusCode})`);
      }
      const token = parseTokenResponse(res.json);
      return { token: token.accessToken, expiresAt: token.expiresAt };
    } finally {
      callbackServer?.close();
      hooks.signal?.removeEventListener('abort', onExternalAbort);
      if (this.active === controller) this.active = null;
    }
  }
}
