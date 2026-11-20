import type { AwsSsmTools } from '@shared/types/ssm';

export type SsmToolsReadiness = 'checking' | 'ready' | 'missing' | 'outdated';

/** Overall state of the two required tools; `null` = not checked yet. */
export function ssmToolsReadiness(tools: AwsSsmTools | null): SsmToolsReadiness {
  if (!tools) return 'checking';
  if (!tools.aws.found || !tools.plugin.found) return 'missing';
  if (tools.plugin.ok === false) return 'outdated';
  return 'ready';
}

/** Polling is only worth it while something is missing (cheap fs checks in main). */
export function shouldPollSsmTools(readiness: SsmToolsReadiness, visible: boolean): boolean {
  return visible && (readiness === 'missing' || readiness === 'outdated');
}
