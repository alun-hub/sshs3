import type { AwsSsoConfig } from './types/aws';
import type { SSHConnectionConfig } from './types/ssh';
import type { SsmInstance, SshSsmConfig } from './types/ssm';
import type { AwsCredentialSource, AwsPickItem } from './types/awsScan';

export interface SsmImportOptions {
  /** Signed-in SSO account/role the instances were found with (kept on the profile so connecting reuses it). */
  sso: AwsSsoConfig;
  region: string;
  username: string;
  /** Instance ids that already have a profile (same account and region); skipped. */
  existing?: ReadonlySet<string>;
  newId?: () => string;
}

/** Folder the imported profiles go in: `AWS/<account>/<region>`. */
export function ssmFolder(sso: AwsSsoConfig, region: string): string {
  return `AWS/${sso.accountId ?? 'account'}/${region}`;
}

/** One SSH profile per instance: host = instance id, auth via the agent, SSM routed through the given SSO sign-in. */
export function buildProfilesFromInstances(instances: readonly SsmInstance[], opts: SsmImportOptions): SSHConnectionConfig[] {
  const newId = opts.newId ?? (() => crypto.randomUUID());
  const seen = new Set(opts.existing ?? []);
  const out: SSHConnectionConfig[] = [];
  for (const inst of instances) {
    if (seen.has(inst.instanceId)) continue;
    seen.add(inst.instanceId);
    out.push({
      id: newId(),
      name: inst.name || inst.instanceId,
      host: inst.instanceId,
      port: 22,
      username: opts.username,
      authType: 'agent',
      group: ssmFolder(opts.sso, opts.region),
      ssm: { enabled: true, region: opts.region, sso: { ...opts.sso } },
    });
  }
  return out;
}

/** The `ssm` settings of a profile for a credential source and the region its instance runs in. */
export function ssmConfigForSource(source: AwsCredentialSource, region: string): SshSsmConfig {
  if (source.kind === 'sso') return { enabled: true, region, sso: { ...source.sso } };
  if (source.kind === 'profile') return { enabled: true, region, awsProfile: source.name };
  return { enabled: true, region };
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
      username: item.username,
      authType: 'agent',
      group: item.folder,
      ssm: ssmConfigForSource(item.source, item.instance.region),
    });
  }
  return out;
}
