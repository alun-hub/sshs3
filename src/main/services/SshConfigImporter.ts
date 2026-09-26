import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import type { SSHConnectionConfig, SSHTunnelConfig } from '../../shared/types/ssh';

function expandTilde(filepath: string): string {
  if (filepath.startsWith('~/') || filepath === '~') {
    return path.join(os.homedir(), filepath.slice(1));
  }
  return filepath;
}

function parseForwardDirective(type: 'local' | 'remote' | 'dynamic', value: string): SSHTunnelConfig | null {
  const parts = value.trim().split(/\s+/);
  if (parts.length === 0) return null;

  try {
    if (type === 'dynamic') {
      const port = parseInt(parts[0], 10);
      if (isNaN(port)) return null;
      return {
        id: crypto.randomUUID(),
        type: 'dynamic',
        localPort: port,
        description: `Dynamic ${port}`,
        enabled: true,
      };
    }

    // Local or Remote forward: can be "port targetHost:targetPort" or "bindAddress:port targetHost:targetPort"
    let sourcePort = 0;
    let targetHost = '127.0.0.1';
    let targetPort = 0;

    if (parts.length >= 2) {
      const src = parts[0];
      const dst = parts[1];

      if (src.includes(':')) {
        const lastColon = src.lastIndexOf(':');
        sourcePort = parseInt(src.substring(lastColon + 1), 10);
      } else {
        sourcePort = parseInt(src, 10);
      }

      if (dst.includes(':')) {
        const lastColon = dst.lastIndexOf(':');
        targetHost = dst.substring(0, lastColon);
        targetPort = parseInt(dst.substring(lastColon + 1), 10);
      }
    }

    if (!sourcePort || !targetPort || isNaN(sourcePort) || isNaN(targetPort)) {
      return null;
    }

    return {
      id: crypto.randomUUID(),
      type,
      localPort: sourcePort,
      remoteHost: targetHost,
      remotePort: targetPort,
      description: `${type === 'local' ? 'Local' : 'Remote'} ${sourcePort} -> ${targetHost}:${targetPort}`,
      enabled: true,
    };
  } catch {
    return null;
  }
}

interface RawHostBlock {
  patterns: string[];
  options: Record<string, string>;
  tunnels: SSHTunnelConfig[];
}

export function parseSshConfigContent(content: string): SSHConnectionConfig[] {
  const lines = content.split(/\r?\n/);
  const blocks: RawHostBlock[] = [];
  let currentBlock: RawHostBlock | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    // Directives can be "Directive Value" or "Directive = Value"
    const match = trimmed.match(/^([A-Za-z0-9_]+)(?:[\s=]+(.*))?$/);
    if (!match) continue;

    const directive = match[1].toLowerCase();
    const value = (match[2] || '').trim();

    if (directive === 'host') {
      const patterns = value.split(/\s+/).filter(Boolean);
      currentBlock = {
        patterns,
        options: {},
        tunnels: [],
      };
      blocks.push(currentBlock);
      continue;
    }

    if (!currentBlock) {
      continue;
    }

    if (directive === 'localforward') {
      const tunnel = parseForwardDirective('local', value);
      if (tunnel) currentBlock.tunnels.push(tunnel);
    } else if (directive === 'remoteforward') {
      const tunnel = parseForwardDirective('remote', value);
      if (tunnel) currentBlock.tunnels.push(tunnel);
    } else if (directive === 'dynamicforward') {
      const tunnel = parseForwardDirective('dynamic', value);
      if (tunnel) currentBlock.tunnels.push(tunnel);
    } else if (!currentBlock.options[directive]) {
      // First one wins in SSH config per host
      currentBlock.options[directive] = value;
    }
  }

  const profiles: SSHConnectionConfig[] = [];

  for (const block of blocks) {
    for (const pattern of block.patterns) {
      // Skip wildcard patterns
      if (pattern.includes('*') || pattern.includes('?')) {
        continue;
      }

      const host = block.options['hostname'] || pattern;
      const username = block.options['user'] || '';
      const portVal = parseInt(block.options['port'], 10);
      const port = isNaN(portVal) ? 22 : portVal;

      let authType: 'password' | 'privateKey' | 'agent' | 'smartcard' = 'agent';
      let privateKeyPath: string | undefined;
      let pkcs11LibPath: string | undefined;

      if (block.options['pkcs11provider']) {
        authType = 'smartcard';
        pkcs11LibPath = expandTilde(block.options['pkcs11provider']);
      } else if (block.options['identityfile']) {
        authType = 'privateKey';
        privateKeyPath = expandTilde(block.options['identityfile']);
      }

      const proxyJump = block.options['proxyjump'] || undefined;
      const forwardAgent = block.options['forwardagent']?.toLowerCase() === 'yes';
      const compression = block.options['compression']?.toLowerCase() === 'yes';
      const serverAliveIntervalVal = parseInt(block.options['serveraliveinterval'], 10);
      const serverAliveInterval = isNaN(serverAliveIntervalVal) ? undefined : serverAliveIntervalVal;

      const profile: SSHConnectionConfig = {
        id: crypto.randomUUID(),
        name: pattern,
        host,
        port,
        username,
        authType,
        privateKeyPath,
        pkcs11LibPath,
        proxyJump,
        forwardAgent,
        compression,
        serverAliveInterval,
        ciphers: block.options['ciphers'] || undefined,
        kexAlgorithms: block.options['kexalgorithms'] || undefined,
        macs: block.options['macs'] || undefined,
        tunnels: block.tunnels.length > 0 ? block.tunnels : undefined,
        group: 'Imported',
      };

      profiles.push(profile);
    }
  }

  return profiles;
}

export async function importSshConfigFile(filePath?: string): Promise<{ profiles: SSHConnectionConfig[]; filePath: string }> {
  const resolvedPath = filePath || path.join(os.homedir(), '.ssh', 'config');
  try {
    const content = await fs.readFile(resolvedPath, 'utf-8');
    const profiles = parseSshConfigContent(content);
    return { profiles, filePath: resolvedPath };
  } catch (err: any) {
    if (err?.code === 'ENOENT') {
      return { profiles: [], filePath: resolvedPath };
    }
    throw err;
  }
}
