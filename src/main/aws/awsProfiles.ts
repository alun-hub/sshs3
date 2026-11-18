import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { isValidAwsProfile, isValidRegion } from '../../shared/ssm';
import type { AwsCliProfile } from '../../shared/types/awsScan';

/**
 * Lists the profiles in the user's AWS CLI configuration for the profile picker.
 *
 * SECURITY: only section names and the *presence* of a few non-secret keys are read, plus `region`. Values of
 * `aws_access_key_id`, `aws_secret_access_key`, `aws_session_token`, `credential_process` and so on are never stored,
 * returned or logged. The files can hold secrets; this parser must not become a way to surface them.
 */

const MAX_FILE_BYTES = 1024 * 1024;
// Keys whose presence tells the profile kind. Their values are discarded.
const KIND_KEYS = new Set(['sso_session', 'sso_start_url', 'sso_account_id', 'role_arn', 'credential_process', 'login_session', 'aws_access_key_id']);

interface Section {
  name: string;
  keys: Set<string>;
  region?: string;
}

function sectionName(header: string, isConfig: boolean): string | undefined {
  const inner = header.trim();
  if (isConfig) {
    if (inner === 'default') return 'default';
    const m = /^profile\s+(\S+)$/.exec(inner);
    return m?.[1];
  }
  return inner;
}

function parseSections(text: string, isConfig: boolean): Section[] {
  const sections: Section[] = [];
  let current: Section | undefined;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const header = /^\[(.+)\]$/.exec(line);
    if (header) {
      const name = sectionName(header[1], isConfig);
      current = name && (name === 'default' || isValidAwsProfile(name)) ? { name, keys: new Set() } : undefined;
      if (current) sections.push(current);
      continue;
    }
    if (!current) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim().toLowerCase();
    if (KIND_KEYS.has(key)) current.keys.add(key);
    else if (key === 'region') {
      const value = line.slice(eq + 1).trim();
      if (isValidRegion(value)) current.region = value;
    }
  }
  return sections;
}

function kindOf(keys: ReadonlySet<string>): AwsCliProfile['kind'] {
  if (keys.has('sso_session') || keys.has('sso_start_url') || keys.has('sso_account_id')) return 'sso';
  if (keys.has('role_arn')) return 'assume-role';
  if (keys.has('credential_process')) return 'process';
  if (keys.has('login_session')) return 'login';
  if (keys.has('aws_access_key_id')) return 'keys';
  return 'other';
}

/** Pure: profiles from the contents of `~/.aws/config` and `~/.aws/credentials`. */
export function parseAwsProfiles(configText: string, credentialsText: string): AwsCliProfile[] {
  const byName = new Map<string, AwsCliProfile>();
  for (const s of parseSections(configText, true)) byName.set(s.name, { name: s.name, kind: kindOf(s.keys), region: s.region });
  // A name only present in the credentials file is a plain access-key profile.
  for (const s of parseSections(credentialsText, false)) {
    const existing = byName.get(s.name);
    if (!existing) byName.set(s.name, { name: s.name, kind: 'keys' });
    else if (existing.kind === 'other') existing.kind = 'keys';
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

async function readSmall(file: string): Promise<string> {
  try {
    const st = await fs.stat(file);
    if (!st.isFile() || st.size > MAX_FILE_BYTES) return '';
    return await fs.readFile(file, 'utf8');
  } catch {
    return '';
  }
}

/** Reads the CLI configuration honouring `AWS_CONFIG_FILE` / `AWS_SHARED_CREDENTIALS_FILE`. */
export async function listAwsCliProfiles(env: NodeJS.ProcessEnv = process.env, home: string = os.homedir()): Promise<AwsCliProfile[]> {
  const config = env.AWS_CONFIG_FILE || path.join(home, '.aws', 'config');
  const credentials = env.AWS_SHARED_CREDENTIALS_FILE || path.join(home, '.aws', 'credentials');
  const [c, k] = await Promise.all([readSmall(config), readSmall(credentials)]);
  return parseAwsProfiles(c, k);
}
