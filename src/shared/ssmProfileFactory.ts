import type { AwsSsoConfig } from './types/aws';
import type { SSHConnectionConfig } from './types/ssh';
import type { SsmInstance } from './types/ssm';

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
