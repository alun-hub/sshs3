import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { isValidSsoConfig } from '../../shared/ssm';
import type { AwsSsoConfig } from '../../shared/types/aws';

/**
 * App-owned AWS config holding one legacy SSO profile, so the AWS CLI can use the token sshs3
 * already caches in ~/.aws/sso/cache without touching the user's ~/.aws/config.
 *
 * SECURITY: an AWS config may contain `credential_process`, which the CLI executes. Every value
 * written here is validated by `isValidSsoConfig` (no whitespace, control characters, `[`, `=`),
 * so a hostile synced profile cannot inject extra keys or sections.
 */
export function ssoProfileName(sso: AwsSsoConfig): string {
  const h = crypto.createHash('sha1').update(`${sso.startUrl}\n${sso.region}\n${sso.accountId ?? ''}\n${sso.roleName ?? ''}`).digest('hex');
  return `sshs3-${h.slice(0, 12)}`;
}

/** Pure: file content for the SSO profile. Throws when a value is not safe to write. */
export function buildSsoConfigFile(sso: AwsSsoConfig): string {
  if (!isValidSsoConfig(sso) || !sso.accountId || !sso.roleName) {
    throw new Error('Invalid AWS SSO settings: account and role are required');
  }
  return [
    `[profile ${ssoProfileName(sso)}]`,
    `sso_start_url = ${sso.startUrl}`,
    `sso_region = ${sso.region}`,
    `sso_account_id = ${sso.accountId}`,
    `sso_role_name = ${sso.roleName}`,
    `region = ${sso.region}`,
    '',
  ].join('\n');
}

/** Atomically writes (temp + rename) the config under `<baseDir>/aws`, dir 0700 / file 0600. Returns its path. */
export function ensureSsoConfigFile(sso: AwsSsoConfig, baseDir: string): string {
  const content = buildSsoConfigFile(sso);
  const dir = path.join(baseDir, 'aws');
  const file = path.join(dir, `${ssoProfileName(sso)}.config`);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    if (fs.lstatSync(file).isSymbolicLink()) fs.rmSync(file);
  } catch {
    /* does not exist yet */
  }
  try {
    if (fs.readFileSync(file, 'utf8') === content) return file;
  } catch {
    /* write below */
  }
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, content, { mode: 0o600, flag: 'wx' });
  fs.renameSync(tmp, file);
  return file;
}
