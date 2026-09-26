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

  it('includes SSH_AUTH_SOCK from profile.agentPath or agentSocketPath parameter', () => {
    const configWithAgentPath: SSHConnectionConfig = {
      id: '4',
      name: 'Agent Server',
      host: 'agent.example.com',
      username: 'deploy',
      authType: 'agent',
      agentPath: '/run/user/1000/custom-agent.sock',
    };
    expect(buildSshCliCommand(configWithAgentPath)).toBe(
      'SSH_AUTH_SOCK=/run/user/1000/custom-agent.sock ssh deploy@agent.example.com'
    );

    const configWithoutAgentPath: SSHConnectionConfig = {
      id: '5',
      name: 'Global Agent Server',
      host: 'global.example.com',
      username: 'deploy',
      authType: 'agent',
    };
    expect(buildSshCliCommand(configWithoutAgentPath, '/run/user/1000/ssh-agent.socket')).toBe(
      'SSH_AUTH_SOCK=/run/user/1000/ssh-agent.socket ssh deploy@global.example.com'
    );

    expect(buildSshCliCommand(configWithoutAgentPath, '/path with spaces/agent.sock')).toBe(
      'SSH_AUTH_SOCK="/path with spaces/agent.sock" ssh deploy@global.example.com'
    );
  });
});
