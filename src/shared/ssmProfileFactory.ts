import type { SSHConnectionConfig } from './types/ssh';
import type { SshSsmConfig, SsmMode } from './types/ssm';
import type { AwsCredentialSource, AwsPickItem } from './types/awsScan';

/** The `ssm` settings of a profile for a credential source and the region its instance runs in. */
export function ssmConfigForSource(source: AwsCredentialSource, region: string, mode?: SsmMode): SshSsmConfig {
  const base: SshSsmConfig = { enabled: true, ...(mode === 'shell' ? { mode } : {}), region };
  if (source.kind === 'sso') return { ...base, sso: { ...source.sso } };
  if (source.kind === 'profile') return { ...base, awsProfile: source.name };
  return base;
}

export interface PickImportOptions {
  /** Instance ids that already have an SSM profile; skipped. */
  existing?: ReadonlySet<string>;
  newId?: () => string;
}

/** One SSH profile per picked instance (agent authentication), in the folder and under the name the guide chose. */
export function buildProfilesFromPicks(items: readonly AwsPickItem[], opts: PickImportOptions = {}): SSHConnectionConfig[] {
  const newId = opts.newId ?? (() => crypto.randomUUID());
  const seen = new Set(opts.existing ?? []);
  const out: SSHConnectionConfig[] = [];
  for (const item of items) {
    const id = item.instance.instanceId;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id: newId(),
      name: item.name || id,
      host: id,
      port: 22,
      // A Session Manager shell has no SSH login; `ssm-user` is the account AWS gives its sessions by default.
      username: item.mode === 'shell' ? 'ssm-user' : item.username,
      authType: item.mode !== 'shell' && item.authType === 'privateKey' && item.privateKeyPath ? 'privateKey' : 'agent',
      ...(item.mode !== 'shell' && item.authType === 'privateKey' && item.privateKeyPath ? { privateKeyPath: item.privateKeyPath } : {}),
      group: item.folder,
      ssm: ssmConfigForSource(item.source, item.instance.region, item.mode),
    });
  }
  return out;
}
