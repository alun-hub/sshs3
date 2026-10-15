import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { createProxySocket } from '../proxy/proxySocket';
import { SystemTrustStore } from '../crypto/SystemTrustStore';
import type { AwsSsoNetworkOptions } from '../../shared/types/aws';

// A hung TLS handshake through a corporate TLS-intercepting proxy otherwise
// leaves `client.send()` pending forever with no error, so the SSO login
// spinner never clears; these bound every request so it fails visibly instead.
const CONNECTION_TIMEOUT_MS = 10_000;
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Builds a NodeHttpHandler for the AWS SSO OIDC/SSO clients that trusts the
 * OS CA store (and any corporate root CA in it) the same way S3StorageProvider
 * does for the S3 client, with the same optional custom-CA/proxy override.
 */
export function buildAwsNodeHttpHandler(options: AwsSsoNetworkOptions = {}): NodeHttpHandler {
  const systemCAs = SystemTrustStore.getCAs();
  const effectiveCa = options.customCaPath
    ? fs.readFileSync(options.customCaPath)
    : systemCAs.length > 0
    ? SystemTrustStore.getMergedRootCertificates()
    : undefined;

  const httpsAgentOptions: https.AgentOptions = {};
  if (options.rejectUnauthorized !== undefined) {
    httpsAgentOptions.rejectUnauthorized = options.rejectUnauthorized;
  }
  if (effectiveCa !== undefined) {
    httpsAgentOptions.ca = effectiveCa;
  }

  const hasProxy = Boolean(options.proxy?.enabled && options.proxy.host);

  if (hasProxy && options.proxy) {
    const proxyCfg = options.proxy;
    const httpAgent = new http.Agent();
    (httpAgent as any).createConnection = (opts: any, cb: any) => {
      createProxySocket(proxyCfg, { host: opts.host || opts.hostname, port: Number(opts.port) || 80 })
        .then((socket) => cb(null, socket))
        .catch((err) => cb(err));
    };

    const httpsAgent = new https.Agent(httpsAgentOptions);
    (httpsAgent as any).createConnection = (opts: any, cb: any) => {
      createProxySocket(proxyCfg, { host: opts.host || opts.hostname, port: Number(opts.port) || 443 })
        .then((socket) => {
          const tlsSocket = tls.connect({
            socket,
            host: opts.host || opts.hostname,
            servername: opts.servername || opts.host || opts.hostname,
            rejectUnauthorized: options.rejectUnauthorized ?? true,
            ca: effectiveCa,
          });
          tlsSocket.on('error', (err) => cb(err));
          cb(null, tlsSocket);
        })
        .catch((err) => cb(err));
    };

    return new NodeHttpHandler({
      httpAgent,
      httpsAgent,
      connectionTimeout: CONNECTION_TIMEOUT_MS,
      requestTimeout: REQUEST_TIMEOUT_MS,
    });
  }

  return new NodeHttpHandler({
    httpsAgent: new https.Agent(httpsAgentOptions),
    connectionTimeout: CONNECTION_TIMEOUT_MS,
    requestTimeout: REQUEST_TIMEOUT_MS,
  });
}
