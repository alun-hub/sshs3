import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { SmartcardDetector } from '../../../src/main/smartcard/SmartcardDetector';
import type { SSHConnectionConfig } from '../../../src/shared/types/ssh';

const hasSsh = spawnSync('ssh', ['-V']).status === 0;

// Phase 0 (POSIX half): a real ssh run with a stub `aws` on PATH proves what ProxyCommand hands to
// the CLI: argv, %h/%p expansion and the env scrub. The Windows half needs a Windows machine.
describe.skipIf(!hasSsh || process.platform === 'win32')('SSM ProxyCommand against a stub aws', () => {
  it('hands the documented argv to aws and scrubs credentials', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ssm-stub-'));
    try {
      const log = path.join(dir, 'argv.log');
      const stub = path.join(dir, 'aws');
      fs.writeFileSync(stub, `#!/bin/sh\n{ printf '%s\\n' "$@"; echo "KEY=$AWS_ACCESS_KEY_ID"; } > "${log}"\nexit 1\n`, { mode: 0o755 });
      fs.writeFileSync(path.join(dir, 'session-manager-plugin'), '#!/bin/sh\necho 1.2.707.0\n', { mode: 0o755 });

      const config = { id: 'x', name: 'n', host: 'i-0123456789abcdef0', port: 2222, username: 'ec2-user', authType: 'agent', ssm: { enabled: true, region: 'eu-north-1', awsProfile: 'prod' } } as SSHConnectionConfig;
      const args = SmartcardDetector.buildSSHArguments(config);
      const env = { ...process.env, PATH: `${dir}:${process.env.PATH}`, AWS_ACCESS_KEY_ID: 'AMBIENT', ...SmartcardDetector.buildProxyEnv(config) };
      const r = spawnSync('ssh', ['-F', '/dev/null', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=no', '-o', 'UserKnownHostsFile=/dev/null', ...args], { env, timeout: 15000, encoding: 'utf8' });
      if (!fs.existsSync(log)) throw new Error(`ssh stderr: ${r.stderr}`);

      const lines = fs.readFileSync(log, 'utf8').split('\n');
      expect(lines).toEqual([
        'ssm', 'start-session', '--target', 'i-0123456789abcdef0', '--document-name', 'AWS-StartSSHSession',
        '--parameters', 'portNumber=2222', '--region', 'eu-north-1', '--profile', 'prod', 'KEY=', '',
      ]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
