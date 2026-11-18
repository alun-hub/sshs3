import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { discoverInstances } from '../../../src/main/aws/AwsSsmDiscoveryService';

/**
 * Opt-in: runs the real discovery code (AWS SDK v3, SigV4, TLS, pagination wiring) against a local
 * aws-emulator. Start it per docs/aws-ssm-plan.md, then:
 *   SSHS3_AWS_EMULATOR_DIR=~/.aws/emulator/9297 npx vitest run tests/main/ssm/ssmEmulator.integration.test.ts
 * The emulator has no way to register a managed node, so only the empty-list and error paths are covered.
 */
const dir = process.env.SSHS3_AWS_EMULATOR_DIR;
const SSO = { startUrl: 'https://d-1.awsapps.com/start', region: 'us-east-1', accountId: '000000000000', roleName: 'Admin' };

function overrides(secretOverride?: string) {
  const d = dir as string;
  const creds = fs.readFileSync(path.join(d, 'emulator_credentials'), 'utf8');
  const get = (k: string) => new RegExp(`^${k}\\s*=\\s*(.+)$`, 'm').exec(creds)![1].trim();
  return {
    endpoint: 'https://127.0.0.1:9297',
    disableHostPrefix: true,
    credentials: { accessKeyId: get('aws_access_key_id'), secretAccessKey: secretOverride ?? get('aws_secret_access_key') },
    requestHandler: new NodeHttpHandler({ httpsAgent: new https.Agent({ ca: fs.readFileSync(path.join(d, 'ca.pem')) }) }),
  };
}

describe.skipIf(!dir)('discoverInstances against aws-emulator', () => {
  it('signs, connects over TLS and returns an empty list when no node is managed', async () => {
    const r = await discoverInstances({ sso: SSO, region: 'us-east-1' }, {}, overrides());
    expect(r).toEqual({ instances: [], truncated: false });
  });

  it('rejects with a readable error when the signature is wrong', async () => {
    await expect(discoverInstances({ sso: SSO, region: 'us-east-1' }, {}, overrides('not-the-secret'))).rejects.toThrow(/signature|credential|token|access|denied/i);
  });
});
