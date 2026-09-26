import type { SSHConnectionConfig } from '@shared/types/ssh';

export function buildSshCliCommand(profile: SSHConnectionConfig, agentSocketPath?: string): string {
  const parts: string[] = [];

  const socket = profile.agentPath?.trim() || agentSocketPath?.trim();
  if (socket) {
    const escaped = /[\s$`\\"]/.test(socket) ? `"${socket.replace(/"/g, '\\"')}"` : socket;
    parts.push(`SSH_AUTH_SOCK=${escaped}`);
  }

  parts.push('ssh');

  if (profile.port && profile.port !== 22) {
    parts.push(`-p ${profile.port}`);
  }

  if (profile.authType === 'privateKey' && profile.privateKeyPath) {
    const key = profile.privateKeyPath.includes(' ') ? `"${profile.privateKeyPath}"` : profile.privateKeyPath;
    parts.push(`-i ${key}`);
  }

  if (profile.authType === 'smartcard' && profile.pkcs11LibPath) {
    const pkcs = profile.pkcs11LibPath.includes(' ') ? `"${profile.pkcs11LibPath}"` : profile.pkcs11LibPath;
    parts.push(`-I ${pkcs}`);
  }

  if (profile.proxyJump) {
    parts.push(`-J ${profile.proxyJump}`);
  }

  if (profile.forwardAgent) {
    parts.push('-A');
  }

  if (profile.compression) {
    parts.push('-C');
  }

  if (profile.serverAliveInterval) {
    parts.push(`-o ServerAliveInterval=${profile.serverAliveInterval}`);
  }

  if (profile.tunnels && profile.tunnels.length > 0) {
    for (const t of profile.tunnels) {
      if (t.enabled === false) continue;
      if (t.type === 'local') {
        parts.push(`-L ${t.localPort}:${t.remoteHost || '127.0.0.1'}:${t.remotePort || t.localPort}`);
      } else if (t.type === 'remote') {
        parts.push(`-R ${t.localPort}:${t.remoteHost || '127.0.0.1'}:${t.remotePort || t.localPort}`);
      } else if (t.type === 'dynamic') {
        parts.push(`-D ${t.localPort}`);
      }
    }
  }

  const destination = profile.username ? `${profile.username}@${profile.host}` : profile.host;
  parts.push(destination);

  return parts.join(' ');
}
