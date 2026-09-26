import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import net from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { SmartcardDetector } from '../../src/main/smartcard/SmartcardDetector';
import { AskpassServer } from '../../src/main/smartcard/AskpassServer';
import type { SSHConnectionConfig } from '../../src/shared/types/ssh';

const execFileAsync = promisify(execFile);

describe('SmartcardDetector', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'multissh-smartcard-test-'));
  });

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  describe('getKnownLibraryPaths', () => {
    it('should return known Linux paths including p11-kit, Net iD and OpenSC, with p11-kit prioritized', () => {
      const linuxPaths = SmartcardDetector.getKnownLibraryPaths('linux');
      expect(linuxPaths.length).toBeGreaterThan(0);

      const p11KitPaths = linuxPaths.filter((l) => l.name === 'p11-kit');
      expect(p11KitPaths.length).toBeGreaterThan(0);
      expect(p11KitPaths.some((l) => l.path.includes('p11-kit-proxy.so'))).toBe(true);

      const netIdPaths = linuxPaths.filter((l) => l.name === 'Net iD');
      expect(netIdPaths.length).toBeGreaterThan(0);
      expect(netIdPaths.some((l) => l.path.includes('libiidp11.so'))).toBe(true);

      const openScPaths = linuxPaths.filter((l) => l.name === 'OpenSC');
      expect(openScPaths.length).toBeGreaterThan(0);
      expect(openScPaths.some((l) => l.path.includes('opensc-pkcs11.so'))).toBe(true);

      // Verify p11-kit is prioritized before Net iD and OpenSC
      const firstP11Index = linuxPaths.findIndex((l) => l.name === 'p11-kit');
      const firstNetIdIndex = linuxPaths.findIndex((l) => l.name === 'Net iD');
      const firstOpenScIndex = linuxPaths.findIndex((l) => l.name === 'OpenSC');
      expect(firstP11Index).toBeLessThan(firstNetIdIndex);
      expect(firstP11Index).toBeLessThan(firstOpenScIndex);

      const yubikeyPaths = linuxPaths.filter((l) => l.name === 'YubiKey (libykcs11)');
      expect(yubikeyPaths.length).toBeGreaterThan(0);
      expect(yubikeyPaths.some((l) => l.path.includes('libykcs11.so.2'))).toBe(true);

      expect(linuxPaths.every((l) => l.platform === 'linux')).toBe(true);
    });

    it('should return known Windows paths including Net iD and OpenSC', () => {
      const winPaths = SmartcardDetector.getKnownLibraryPaths('win32');
      expect(winPaths.length).toBeGreaterThan(0);

      const netIdPaths = winPaths.filter((l) => l.name === 'Net iD');
      expect(netIdPaths.length).toBeGreaterThan(0);
      expect(netIdPaths.some((l) => l.path.includes('iidp11.dll'))).toBe(true);

      const openScPaths = winPaths.filter((l) => l.name === 'OpenSC');
      expect(openScPaths.length).toBeGreaterThan(0);
      expect(
        openScPaths.some(
          (l) =>
            l.path.includes('onepin-opensc-pkcs11.dll') ||
            l.path.includes('opensc-pkcs11.dll')
        )
      ).toBe(true);

      expect(winPaths.every((l) => l.platform === 'win32')).toBe(true);
    });

    it('should default to current platform when platform is omitted', () => {
      const paths = SmartcardDetector.getKnownLibraryPaths();
      const currentPlatform = process.platform === 'win32' ? 'win32' : 'linux';
      expect(paths.every((l) => l.platform === currentPlatform)).toBe(true);
    });
  });

  describe('validateLibraryPath', () => {
    it('should return true for an existing file', async () => {
      const fakeLib = path.join(tempDir, 'libtest.so');
      await fs.writeFile(fakeLib, 'binary-data');

      const isValid = await SmartcardDetector.validateLibraryPath(fakeLib);
      expect(isValid).toBe(true);
    });

    it('should return false for a non-existent file', async () => {
      const missingLib = path.join(tempDir, 'non-existent.so');
      const isValid = await SmartcardDetector.validateLibraryPath(missingLib);
      expect(isValid).toBe(false);
    });

    it('should return false for a directory path', async () => {
      const subDir = path.join(tempDir, 'not-a-file');
      await fs.mkdir(subDir);

      const isValid = await SmartcardDetector.validateLibraryPath(subDir);
      expect(isValid).toBe(false);
    });
  });

  describe('detectAvailableLibraries', () => {
    it('should return libraries with exists boolean', async () => {
      const libs = await SmartcardDetector.detectAvailableLibraries('linux');
      expect(libs.length).toBeGreaterThan(0);
      for (const lib of libs) {
        expect(lib).toHaveProperty('name');
        expect(lib).toHaveProperty('path');
        expect(lib).toHaveProperty('platform', 'linux');
        expect(typeof lib.exists).toBe('boolean');
      }
    });

    it('should correctly mark existing libraries when present', async () => {
      const fakeLibPath = path.join(tempDir, 'libiidp11.so');
      await fs.writeFile(fakeLibPath, 'test-lib');

      const detected = await SmartcardDetector.detectAvailableLibraries('linux', {
        customPaths: [{ name: 'Custom Net iD', path: fakeLibPath, platform: 'linux' }],
      });

      expect(detected).toHaveLength(1);
      expect(detected[0].exists).toBe(true);
      expect(detected[0].name).toBe('Custom Net iD');
    });

    it('should filter only existing libraries when onlyExisting is true', async () => {
      const fakeLibPath = path.join(tempDir, 'libiidp11.so');
      await fs.writeFile(fakeLibPath, 'test-lib');

      const detected = await SmartcardDetector.detectAvailableLibraries('linux', {
        customPaths: [
          { name: 'Found Lib', path: fakeLibPath, platform: 'linux' },
          { name: 'Missing Lib', path: path.join(tempDir, 'missing.so'), platform: 'linux' },
        ],
        onlyExisting: true,
      });

      expect(detected).toHaveLength(1);
      expect(detected[0].name).toBe('Found Lib');
      expect(detected[0].exists).toBe(true);
    });

    it('should deduplicate multiple candidate paths pointing to the same file', async () => {
      const realLib = path.join(tempDir, 'libykcs11.so.2.7.3');
      const symlinkLib = path.join(tempDir, 'libykcs11.so.2');
      await fs.writeFile(realLib, 'binary-lib');
      try {
        await fs.symlink(realLib, symlinkLib);
      } catch {
        // If symlinks not supported, skip
        return;
      }

      const detected = await SmartcardDetector.detectAvailableLibraries('linux', {
        customPaths: [
          { name: 'YubiKey (libykcs11)', path: symlinkLib, platform: 'linux' },
          { name: 'YubiKey (libykcs11)', path: realLib, platform: 'linux' },
        ],
        onlyExisting: true,
      });

      expect(detected).toHaveLength(1);
      expect(detected[0].path).toBe(symlinkLib);
    });
  });

  describe('buildSSHArguments', () => {
    it('should include -I <pkcs11LibPath> when authType is smartcard', () => {
      const config: SSHConnectionConfig = {
        id: 'sc-1',
        name: 'Smartcard Host',
        host: 'bastion.corp.net',
        port: 22,
        username: 'secadmin',
        authType: 'smartcard',
        pkcs11LibPath: '/usr/lib64/libiidp11.so',
      };

      const args = SmartcardDetector.buildSSHArguments(config);

      expect(args).toContain('-I');
      const idx = args.indexOf('-I');
      expect(args[idx + 1]).toBe('/usr/lib64/libiidp11.so');
      expect(args).toContain('-p');
      expect(args[args.indexOf('-p') + 1]).toBe('22');
      expect(args).toContain('--');
      const dashDashIdx = args.indexOf('--');
      expect(args[dashDashIdx + 1]).toBe('secadmin@bastion.corp.net');
    });

    it('should authenticate via the pre-loaded agent (not -I) when agentPath is set', () => {
      const config: SSHConnectionConfig = {
        id: 'sc-agent-1',
        name: 'Smartcard Host (agent)',
        host: 'bastion.corp.net',
        port: 22,
        username: 'secadmin',
        authType: 'smartcard',
        pkcs11LibPath: '/usr/lib64/libiidp11.so',
        agentPath: '/tmp/sshs3-agent.sock',
      };

      const args = SmartcardDetector.buildSSHArguments(config);

      expect(args).not.toContain('-I');
      if (process.platform === 'win32') {
        // Win32-OpenSSH's `IdentityAgent` config value can't resolve a raw named
        // pipe (confirmed by hand) — the agent must be picked up purely via the
        // SSH_AUTH_SOCK env var that SSHPtyManager sets, not this flag.
        expect(args).not.toContain('IdentityAgent=/tmp/sshs3-agent.sock');
        expect(args.join(' ')).not.toContain('IdentityAgent=');
      } else {
        expect(args).toContain('-o');
        expect(args).toContain('IdentityAgent=/tmp/sshs3-agent.sock');
      }
    });

    it('should NOT include -I and include PKCS11Provider=none when authType is not smartcard', () => {
      const config: SSHConnectionConfig = {
        id: 'pw-1',
        name: 'Password Host',
        host: 'dev.example.com',
        username: 'developer',
        authType: 'password',
        pkcs11LibPath: '/usr/lib/libiidp11.so', // should be ignored
      };

      const args = SmartcardDetector.buildSSHArguments(config);

      expect(args).not.toContain('-I');
      expect(args).toContain('PKCS11Provider=none');
      expect(args).toContain('-p');
      expect(args[args.indexOf('-p') + 1]).toBe('22');
      expect(args).toContain('--');
      expect(args).toContain('developer@dev.example.com');
    });

    it('should include -i <key> when privateKeyPath is specified', () => {
      const config: SSHConnectionConfig = {
        id: 'key-1',
        name: 'Key Host',
        host: 'prod.example.com',
        port: 2222,
        username: 'ubuntu',
        authType: 'privateKey',
        privateKeyPath: '/home/ubuntu/.ssh/id_ed25519',
      };

      const args = SmartcardDetector.buildSSHArguments(config);

      expect(args).toContain('-i');
      expect(args[args.indexOf('-i') + 1]).toBe('/home/ubuntu/.ssh/id_ed25519');
      expect(args).toContain('-p');
      expect(args[args.indexOf('-p') + 1]).toBe('2222');
      expect(args).toContain('--');
      expect(args).toContain('ubuntu@prod.example.com');
    });

    it('should format extraOptions as -o Key=Value', () => {
      const config: SSHConnectionConfig = {
        id: 'opt-1',
        name: 'Extra Options Host',
        host: 'custom.host',
        username: 'root',
        authType: 'password',
        extraOptions: {
          ServerAliveInterval: '60',
          StrictHostKeyChecking: 'accept-new',
        },
      };

      const args = SmartcardDetector.buildSSHArguments(config);

      expect(args).toContain('-o');
      expect(args).toContain('ServerAliveInterval=60');
      expect(args).toContain('StrictHostKeyChecking=accept-new');
      expect(args).toContain('--');
      expect(args).toContain('root@custom.host');
    });

    it('should throw error when host starts with "-" to prevent SSH argument injection', () => {
      const config: SSHConnectionConfig = {
        id: 'bad-host',
        name: 'Malicious Host',
        host: '-oProxyCommand=rm -rf /',
        username: 'attacker',
        authType: 'password',
      };

      expect(() => SmartcardDetector.buildSSHArguments(config)).toThrow(
        /host cannot start with "-"/
      );
    });

    it('should throw error when port is invalid', () => {
      const baseConfig: SSHConnectionConfig = {
        id: 'bad-port',
        name: 'Bad Port',
        host: 'example.com',
        username: 'user',
        authType: 'password',
      };

      expect(() => SmartcardDetector.buildSSHArguments({ ...baseConfig, port: 0 })).toThrow(
        /port must be between 1 and 65535/
      );
      expect(() => SmartcardDetector.buildSSHArguments({ ...baseConfig, port: 70000 })).toThrow(
        /port must be between 1 and 65535/
      );
      expect(() => SmartcardDetector.buildSSHArguments({ ...baseConfig, port: 22.5 })).toThrow(
        /port must be between 1 and 65535/
      );
    });

    it('should generate ProxyCommand for unauthenticated HTTP proxy', () => {
      const config: SSHConnectionConfig = {
        id: 'proxy-http',
        name: 'HTTP Proxy Host',
        host: 'example.com',
        username: 'user',
        authType: 'password',
        proxy: {
          enabled: true,
          type: 'http',
          host: '127.0.0.1',
          port: 8080,
        },
      };

      const args = SmartcardDetector.buildSSHArguments(config);
      expect(args).toContain('-o');
      const proxyOpt = args.find((a) => a.startsWith('ProxyCommand='));
      expect(proxyOpt).toBeDefined();
      expect(proxyOpt).toContain('proxyCli.cjs" http 127.0.0.1 8080 %h %p');
    });

    it('should generate ProxyCommand for unauthenticated SOCKS5 proxy', () => {
      const config: SSHConnectionConfig = {
        id: 'proxy-socks5',
        name: 'SOCKS5 Proxy Host',
        host: 'example.com',
        username: 'user',
        authType: 'password',
        proxy: {
          enabled: true,
          type: 'socks5',
          host: '10.0.0.1',
          port: 1080,
        },
      };

      const args = SmartcardDetector.buildSSHArguments(config);
      const proxyOpt = args.find((a) => a.startsWith('ProxyCommand='));
      expect(proxyOpt).toBeDefined();
      expect(proxyOpt).toContain('proxyCli.cjs" socks5 10.0.0.1 1080 %h %p');
    });

    it('should generate proxyCli ProxyCommand when proxy authentication is configured, without embedding the credentials in it', () => {
      const config: SSHConnectionConfig = {
        id: 'proxy-auth',
        name: 'Auth Proxy Host',
        host: 'example.com',
        username: 'user',
        authType: 'password',
        proxy: {
          enabled: true,
          type: 'socks5',
          host: '10.0.0.1',
          port: 1080,
          username: 'proxyuser',
          password: 'secret',
        },
      };

      const args = SmartcardDetector.buildSSHArguments(config);
      const proxyOpt = args.find((a) => a.startsWith('ProxyCommand='));
      expect(proxyOpt).toBeDefined();
      expect(proxyOpt).toContain('proxyCli.cjs" socks5 10.0.0.1 1080 %h %p');
      // Credentials must never be embedded in the ProxyCommand string: OpenSSH
      // runs it through a shell, so free-text creds there would be a command
      // injection vector. They travel via env instead (buildProxyEnv).
      expect(proxyOpt).not.toContain('proxyuser');
      expect(proxyOpt).not.toContain('secret');

      const env = SmartcardDetector.buildProxyEnv(config);
      expect(env.SSHS3_PROXY_USERNAME).toBe('proxyuser');
      expect(env.SSHS3_PROXY_PASSWORD).toBe('secret');
    });

    it('should reject shell metacharacters in the destination host (ProxyCommand %h injection)', () => {
      const config: SSHConnectionConfig = {
        id: 'inject-host',
        name: 'Injection Host',
        host: 'example.com"; touch /tmp/pwned; echo "',
        username: 'user',
        authType: 'password',
      };

      expect(() => SmartcardDetector.buildSSHArguments(config)).toThrow(
        /Invalid SSH host/
      );
    });

    it('should reject shell metacharacters in the proxy host', () => {
      const config: SSHConnectionConfig = {
        id: 'inject-proxy-host',
        name: 'Injection Proxy Host',
        host: 'example.com',
        username: 'user',
        authType: 'password',
        proxy: {
          enabled: true,
          type: 'socks5',
          host: '10.0.0.1"; touch /tmp/pwned; echo "',
          port: 1080,
        },
      };

      expect(() => SmartcardDetector.buildSSHArguments(config)).toThrow(
        /Invalid proxy host/
      );
    });

    it('should add proxyJump and advanced options (compression, keepalive, ciphers, kex, macs)', () => {
      const config: SSHConnectionConfig = {
        id: 'adv-ssh',
        name: 'Advanced Host',
        host: 'example.com',
        username: 'user',
        authType: 'password',
        proxyJump: 'jump.example.com:2222',
        compression: true,
        serverAliveInterval: 45,
        ciphers: 'aes128-ctr,aes256-ctr',
        kexAlgorithms: 'curve25519-sha256',
        macs: 'hmac-sha2-256',
      };

      const args = SmartcardDetector.buildSSHArguments(config);
      expect(args).toContain('-J');
      expect(args).toContain('jump.example.com:2222');
      expect(args).toContain('Compression=yes');
      expect(args).toContain('ServerAliveInterval=45');
      expect(args).toContain('Ciphers=aes128-ctr,aes256-ctr');
      expect(args).toContain('KexAlgorithms=curve25519-sha256');
      expect(args).toContain('MACs=hmac-sha2-256');
    });

    it('should add ForwardAgent=yes when forwardAgent is true, ForwardAgent=no when false, and omit when undefined', () => {
      const base: SSHConnectionConfig = {
        id: 'agent-fwd-test',
        name: 'Agent Fwd Test',
        host: 'example.com',
        username: 'user',
        authType: 'password',
      };

      const argsTrue = SmartcardDetector.buildSSHArguments({ ...base, forwardAgent: true });
      expect(argsTrue).toContain('-o');
      expect(argsTrue).toContain('ForwardAgent=yes');

      const argsFalse = SmartcardDetector.buildSSHArguments({ ...base, forwardAgent: false });
      expect(argsFalse).toContain('-o');
      expect(argsFalse).toContain('ForwardAgent=no');

      const argsUndefined = SmartcardDetector.buildSSHArguments(base);
      expect(argsUndefined.some((a) => a.startsWith('ForwardAgent='))).toBe(false);
    });

    it('should include -Y when x11Forwarding is enabled', () => {
      const base: SSHConnectionConfig = {
        id: 'x11-test',
        name: 'X11 Host',
        host: 'example.com',
        username: 'user',
        authType: 'password',
      };

      const argsTrue = SmartcardDetector.buildSSHArguments({ ...base, x11Forwarding: true });
      expect(argsTrue).toContain('-Y');

      const argsFalse = SmartcardDetector.buildSSHArguments({ ...base, x11Forwarding: false });
      expect(argsFalse).not.toContain('-Y');

      const argsUndefined = SmartcardDetector.buildSSHArguments(base);
      expect(argsUndefined).not.toContain('-Y');
    });

    it('should configure port tunnels (-L, -R, -D) for enabled tunnels', () => {
      const config: SSHConnectionConfig = {
        id: 'tunnels-ssh',
        name: 'Tunnels Host',
        host: 'example.com',
        username: 'user',
        authType: 'password',
        tunnels: [
          {
            id: 't1',
            type: 'local',
            localPort: 8080,
            remoteHost: '127.0.0.1',
            remotePort: 80,
            enabled: true,
          },
          {
            id: 't2',
            type: 'remote',
            localPort: 9000,
            remoteHost: '192.168.1.50',
            remotePort: 3000,
            enabled: true,
          },
          {
            id: 't3',
            type: 'dynamic',
            localPort: 1088,
            enabled: true,
          },
          {
            id: 't4',
            type: 'local',
            localPort: 5432,
            remoteHost: 'localhost',
            remotePort: 5432,
            enabled: false, // disabled should be skipped
          },
        ],
      };

      const args = SmartcardDetector.buildSSHArguments(config);
      expect(args).toContain('-L');
      expect(args).toContain('8080:127.0.0.1:80');
      expect(args).toContain('-R');
      expect(args).toContain('9000:192.168.1.50:3000');
      expect(args).toContain('-D');
      expect(args).toContain('1088');
      expect(args).not.toContain('5432:localhost:5432');
    });
  });
});

describe('AskpassServer', () => {
  let server: AskpassServer;

  afterEach(async () => {
    if (server && server.isRunning()) {
      await server.stop();
    }
  });

  it('should start server, create executable askpass script with restrictive permissions, and return env vars', async () => {
    server = new AskpassServer();
    const { port, scriptPath } = await server.start();

    expect(port).toBeGreaterThan(0);
    expect(scriptPath).toBeTruthy();
    expect(server.isRunning()).toBe(true);

    // Verify script file exists and has restrictive permissions (0o700)
    const stat = await fs.stat(scriptPath);
    expect(stat.isFile()).toBe(true);
    if (process.platform !== 'win32') {
      expect((stat.mode & 0o777) === 0o700).toBe(true);
    }

    const env = server.getEnv();
    expect(env.SSH_ASKPASS).toBe(scriptPath);
    expect(env.SSH_ASKPASS_REQUIRE).toBe('force');
    expect(env.DISPLAY).toBeDefined();

    await server.stop();
    expect(server.isRunning()).toBe(false);

    // Verify script file cleaned up
    await expect(fs.access(scriptPath)).rejects.toThrow();
  });

  it.skipIf(process.platform === 'win32')('should handle PIN request via promptHandler callback', async () => {
    const expectedPin = '987654';
    server = new AskpassServer({
      promptHandler: async (prompt) => {
        expect(prompt).toContain('Enter PIN');
        return expectedPin;
      },
    });

    await server.start();
    const scriptPath = server.getScriptPath();

    // Execute the generated askpass script as OpenSSH would
    const { stdout } = await execFileAsync(scriptPath, ['Enter PIN for token: ']);
    expect(stdout.trim()).toBe(expectedPin);
  });

  it.skipIf(process.platform === 'win32')('should handle PIN request via prompt event', async () => {
    const expectedPin = '123456';
    server = new AskpassServer();

    server.on('prompt', (prompt: string, callback: (pin: string) => void) => {
      expect(prompt).toContain('Smartcard PIN');
      callback(expectedPin);
    });

    await server.start();
    const scriptPath = server.getScriptPath();

    const { stdout } = await execFileAsync(scriptPath, ['Smartcard PIN: ']);
    expect(stdout.trim()).toBe(expectedPin);
  });

  it('should reject unauthorized TCP connection without valid token', async () => {
    server = new AskpassServer();
    const { port } = await server.start();

    // Connect raw TCP socket with invalid token
    const client = net.createConnection({ port, host: '127.0.0.1' });
    const response = await new Promise<string>((resolve) => {
      client.on('connect', () => {
        client.write(JSON.stringify({ token: 'wrong-token', prompt: 'test' }) + '\n');
      });
      client.on('data', (data) => resolve(data.toString()));
      client.on('close', () => resolve('closed'));
    });

    expect(response).toMatch(/unauthorized|closed|error/i);
  });

  it('should handle socket error without crashing server', async () => {
    server = new AskpassServer();
    const { port } = await server.start();

    // Connect socket and immediately destroy it with reset to trigger error
    const client = net.createConnection({ port, host: '127.0.0.1' }, () => {
      client.destroy(new Error('Simulated socket error'));
    });

    await new Promise<void>((resolve) => {
      client.on('error', () => resolve());
      client.on('close', () => resolve());
    });

    // Server should still be running and able to accept subsequent requests
    expect(server.isRunning()).toBe(true);
  });

  it('should disconnect clients exceeding buffer limit', async () => {
    server = new AskpassServer();
    const { port } = await server.start();

    const client = net.createConnection({ port, host: '127.0.0.1' });
    const closed = await new Promise<boolean>((resolve) => {
      client.on('connect', () => {
        // Send oversized chunk > 64KB without newline
        const junk = 'A'.repeat(70000);
        client.write(junk);
      });
      client.on('close', () => resolve(true));
      client.on('error', () => resolve(true));
    });

    expect(closed).toBe(true);
  });
});
