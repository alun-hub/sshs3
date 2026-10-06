import type React from 'react';
import { Boxes, Cloud, HardDrive, Server } from 'lucide-react';
import type { SourceType } from './types';

export function toWebRepoUrl(gitUrl: string): string | undefined {
  const trimmed = gitUrl.trim();
  const scpMatch = /^git@([^:]+):([^/]+)\/(.+?)(\.git)?$/.exec(trimmed);
  if (scpMatch) {
    const [, host, owner, repo] = scpMatch;
    return `https://${host}/${owner}/${repo}`;
  }
  if (trimmed.startsWith('https://') || trimmed.startsWith('http://')) {
    return trimmed.replace(/\.git$/, '');
  }
  return undefined;
}

export const SOURCE_ICONS: Record<SourceType, React.ComponentType<{ className?: string }>> = {
  local: HardDrive,
  sftp: Server,
  s3: Cloud,
  k8s: Boxes,
};
