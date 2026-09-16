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
    it('should return known Linux paths including Net iD and OpenSC', () => {
      const linuxPaths = SmartcardDetector.getKnownLibraryPaths('linux');
      expect(linuxPaths.length).toBeGreaterThan(0);

      const netIdPaths = linuxPaths.filter((l) => l.name === 'Net iD');
      expect(netIdPaths.length).toBeGreaterThan(0);
      expect(netIdPaths.some((l) => l.path.includes('libiidp11.so'))).toBe(true);

      const openScPaths = linuxPaths.filter((l) => l.name === 'OpenSC');
      expect(openScPaths.length).toBeGreaterThan(0);
      expect(openScPaths.some((l) => l.path.includes('opensc-pkcs11.so'))).toBe(true);

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

    it('should NOT include -I when authType is not smartcard', () => {
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
      expect(proxyOpt).toContain('127.0.0.1:8080 %h %p');
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
      expect(proxyOpt).toContain('nc -X 5 -x 10.0.0.1:1080 %h %p');
    });

    it('should generate proxyCli ProxyCommand when proxy authentication is configured', () => {
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
      expect(proxyOpt).toContain('proxyCli.cjs');
      expect(proxyOpt).toContain('"proxyuser" "secret"');
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

  it('should handle PIN request via promptHandler callback', async () => {
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

  it('should handle PIN request via prompt event', async () => {
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
