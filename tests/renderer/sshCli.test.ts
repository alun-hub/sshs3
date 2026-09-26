import { describe, it, expect } from 'vitest';
import { buildSshCliCommand } from '../../src/renderer/src/lib/sshCli';
import type { SSHConnectionConfig } from '../../src/shared/types/ssh';

describe('buildSshCliCommand', () => {
  it('generates standard ssh command with user@host', () => {
    const config: SSHConnectionConfig = {
      id: '1',
      name: 'Server 1',
      host: 'example.com',
      username: 'root',
      authType: 'password',
    };
    expect(buildSshCliCommand(config)).toBe('ssh root@example.com');
  });

  it('includes port, identity file, jump host, forward agent and compression', () => {
    const config: SSHConnectionConfig = {
      id: '2',
      name: 'Custom Server',
      host: 'bastion.net',
      port: 2222,
      username: 'ubuntu',
      authType: 'privateKey',
      privateKeyPath: '/home/user/.ssh/id_ed25519',
      proxyJump: 'jump.net',
      forwardAgent: true,
      compression: true,
      serverAliveInterval: 60,
    };
    expect(buildSshCliCommand(config)).toBe(
      'ssh -p 2222 -i /home/user/.ssh/id_ed25519 -J jump.net -A -C -o ServerAliveInterval=60 ubuntu@bastion.net'
    );
  });

  it('includes port forwards', () => {
    const config: SSHConnectionConfig = {
      id: '3',
      name: 'Tunnel Server',
      host: '10.0.0.5',
      username: 'admin',
      authType: 'password',
      tunnels: [
        { id: 't1', type: 'local', localPort: 8080, remoteHost: 'localhost', remotePort: 80, enabled: true },
        { id: 't2', type: 'dynamic', localPort: 1080, enabled: true },
      ],
    };
    expect(buildSshCliCommand(config)).toBe(
      'ssh -L 8080:localhost:80 -D 1080 admin@10.0.0.5'
    );
  });
});
