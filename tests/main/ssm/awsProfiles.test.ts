import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseAwsProfiles, listAwsCliProfiles } from '../../../src/main/aws/awsProfiles';

const CONFIG = `
[default]
region = eu-north-1

[profile corp-sso]
sso_session = corp
sso_account_id = 123456789012
sso_role_name = Dev
region = eu-west-1

[sso-session corp]
sso_start_url = https://corp.awsapps.com/start
sso_region = us-east-1

[profile deploy]
role_arn = arn:aws:iam::123456789012:role/Deploy
source_profile = corp-sso

[profile vault]
credential_process = /usr/bin/aws-vault export --format=json super-secret-profile

[profile console]
login_session = arn:aws:sts::1:assumed-role/X/y

[profile inline-keys]
aws_access_key_id = AKIAINLINEEXAMPLE
aws_secret_access_key = inline-secret-value-123

[profile bad name; rm -rf /]
region = us-east-1
`;
const CREDENTIALS = `
[default]
aws_access_key_id = AKIADEFAULTEXAMPLE
aws_secret_access_key = default-secret-value-456

[keys-only]
aws_access_key_id = AKIAKEYSONLYEXAMPLE
aws_secret_access_key = keys-only-secret-789
aws_session_token = FwoGZXIvYXdzSESSIONTOKEN
`;

describe('parseAwsProfiles', () => {
  const profiles = parseAwsProfiles(CONFIG, CREDENTIALS);
  const by = Object.fromEntries(profiles.map((p) => [p.name, p]));

  it('classifies profiles by kind and keeps the region', () => {
    expect(by['corp-sso']).toEqual({ name: 'corp-sso', kind: 'sso', region: 'eu-west-1' });
    expect(by.deploy.kind).toBe('assume-role');
    expect(by.vault.kind).toBe('process');
    expect(by.console.kind).toBe('login');
    expect(by['inline-keys'].kind).toBe('keys');
    expect(by['keys-only'].kind).toBe('keys');
    expect(by.default).toMatchObject({ region: 'eu-north-1' });
  });
  it('ignores sso-session sections and invalid profile names', () => {
    expect(profiles.map((p) => p.name)).not.toContain('corp');
    expect(profiles.some((p) => p.name.includes('rm -rf'))).toBe(false);
  });
  it('never exposes secrets, key ids, commands or ARNs', () => {
    const out = JSON.stringify(profiles);
    for (const secret of ['AKIA', 'secret-value', 'SESSIONTOKEN', 'aws-vault', 'super-secret-profile', 'arn:aws', 'corp.awsapps.com', '123456789012']) {
      expect(out).not.toContain(secret);
    }
  });
  it('is sorted by name', () => {
    expect(profiles.map((p) => p.name)).toEqual([...profiles.map((p) => p.name)].sort((a, b) => a.localeCompare(b)));
  });
});

describe('listAwsCliProfiles', () => {
  it('reads the files named by AWS_CONFIG_FILE / AWS_SHARED_CREDENTIALS_FILE and tolerates missing files', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aws-prof-'));
    try {
      fs.writeFileSync(path.join(dir, 'config'), '[profile one]\nregion = us-east-1\n');
      const out = await listAwsCliProfiles({ AWS_CONFIG_FILE: path.join(dir, 'config'), AWS_SHARED_CREDENTIALS_FILE: path.join(dir, 'missing') }, '/nonexistent');
      expect(out).toEqual([{ name: 'one', kind: 'other', region: 'us-east-1' }]);
      expect(await listAwsCliProfiles({ AWS_CONFIG_FILE: path.join(dir, 'nope') }, dir)).toEqual([]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
