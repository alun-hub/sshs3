import type { SSHConnectionConfig } from '@shared/types/ssh';
import type { S3Config } from '@shared/types/storage';
import { collectLeaves } from './paneTree';
import { sftpUnavailableReason } from './platform';
import type { AppTab } from './tabs';

/**
 * One row the global search can find. Built from the profiles and tabs but carries only what is
 * shown or matched (names, hosts, folders, tags): never a password, key, PIN or token. Acting on an
 * entry looks the real profile up again by `source` + `ref`.
 */
export interface SearchEntry {
  /** Unique across kinds and sources. */
  id: string;
  kind: 'ssh' | 's3' | 'tab' | 'action';
  title: string;
  subtitle: string;
  /** Folder path of a profile, searched like the subtitle. */
  group?: string;
  tags: string[];
  /** 'personal' or a Team Vault id; empty for tabs. */
  source: string;
  /** Team Vault name, for the badge. */
  sourceLabel?: string;
  lastUsedAt?: string;
  /** Profile id, or tab id for a tab. */
  ref: string;
  /** Whether the SFTP action is offered (SSH profiles only). */
  sftp: boolean;
}

export interface SearchSource {
  source: string;
  label?: string;
  ssh: SSHConnectionConfig[];
  s3: S3Config[];
}

export function buildProfileEntries(sources: SearchSource[]): SearchEntry[] {
  const entries: SearchEntry[] = [];
  for (const { source, label, ssh, s3 } of sources) {
    for (const p of ssh) {
      const port = p.port && p.port !== 22 ? `:${p.port}` : '';
      entries.push({
        id: `ssh:${source}:${p.id}`,
        kind: 'ssh',
        title: p.name,
        subtitle: `${p.username}@${p.host}${port}`,
        group: p.group,
        tags: p.tags ?? [],
        source,
        sourceLabel: label,
        lastUsedAt: p.lastUsedAt,
        ref: p.id,
        sftp: !sftpUnavailableReason(p.authType),
      });
    }
    for (const p of s3) {
      entries.push({
        id: `s3:${source}:${p.id}`,
        kind: 's3',
        title: p.name,
        subtitle: `${p.endpoint || 'AWS S3'} · ${p.region}`,
        group: p.group,
        tags: p.tags ?? [],
        source,
        sourceLabel: label,
        lastUsedAt: p.lastUsedAt,
        ref: p.id,
        sftp: false,
      });
    }
  }
  return entries;
}

function tabSubtitle(tab: AppTab): string {
  if (tab.type === 'filemanager') return 'File manager';
  if (tab.type === 'editor') return 'Editor';
  const leaf = tab.paneTree ? collectLeaves(tab.paneTree)[0] : undefined;
  const host = leaf?.dynamicHost || leaf?.baseHost || leaf?.config?.host;
  return host ? `Terminal · ${host}` : 'Terminal';
}

export function buildTabEntries(tabs: AppTab[]): SearchEntry[] {
  return tabs.map((tab) => ({
    id: `tab:${tab.id}`,
    kind: 'tab',
    title: tab.title,
    subtitle: tabSubtitle(tab),
    tags: [],
    source: '',
    ref: tab.id,
    sftp: false,
  }));
}
