import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { scanInstances } from '../../../src/main/aws/awsScanService';

/**
 * Opt-in: runs the real scan code (AWS SDK v3, SigV4, TLS, pagination wiring) against a local
 * aws-emulator. Start it per docs/aws-ssm-plan.md, then:
 *   SSHS3_AWS_EMULATOR_DIR=~/.aws/emulator/9297 npx vitest run tests/main/ssm/ssmEmulator.integration.test.ts
 * The emulator has no way to register a managed node, so only the empty-list and error paths are covered.
 */
const dir = process.env.SSHS3_AWS_EMULATOR_DIR;
const request = { targets: [{ id: 'emu', label: 'emulator', source: { kind: 'default' as const } }], regions: ['us-east-1'] };

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

describe.skipIf(!dir)('scanInstances against aws-emulator', () => {
  it('signs, connects over TLS and finds no node when none is managed', async () => {
    const r = await scanInstances(request, { includeNames: false, clientOverrides: () => overrides() });
    expect(r).toEqual({ instances: [], skipped: [], truncated: false, searched: 1 });
  });

  it('records a readable skip reason when the signature is wrong', async () => {
    const r = await scanInstances(request, { includeNames: false, clientOverrides: () => overrides('not-the-secret') });
    expect(r.instances).toEqual([]);
    expect(r.skipped).toHaveLength(1);
    expect(r.skipped[0].message).toMatch(/signature|credential|token|access|denied|not allowed/i);
  });
});
