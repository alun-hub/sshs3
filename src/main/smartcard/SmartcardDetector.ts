import fs from 'node:fs/promises';
import path from 'node:path';
import type { DetectedSmartcardLib, SSHConnectionConfig } from '../../shared/types/ssh';

export interface DetectOptions {
  customPaths?: Array<{ name: string; path: string; platform: 'linux' | 'win32' }>;
  onlyExisting?: boolean;
}

export class SmartcardDetector {
  private static readonly LINUX_LIBRARIES: Array<{ name: string; path: string; platform: 'linux' }> = [
    // Net iD
    { name: 'Net iD', path: '/usr/lib/libiidp11.so', platform: 'linux' },
    { name: 'Net iD', path: '/usr/lib64/libiidp11.so', platform: 'linux' },
    { name: 'Net iD', path: '/usr/local/lib/libiidp11.so', platform: 'linux' },
    { name: 'Net iD', path: '/usr/lib/x86_64-linux-gnu/libiidp11.so', platform: 'linux' },
    // OpenSC
    { name: 'OpenSC', path: '/usr/lib/x86_64-linux-gnu/opensc-pkcs11.so', platform: 'linux' },
    { name: 'OpenSC', path: '/usr/lib/opensc-pkcs11.so', platform: 'linux' },
    { name: 'OpenSC', path: '/usr/lib64/opensc-pkcs11.so', platform: 'linux' },
    { name: 'OpenSC', path: '/usr/lib/pkcs11/opensc-pkcs11.so', platform: 'linux' },
    { name: 'OpenSC', path: '/usr/local/lib/opensc-pkcs11.so', platform: 'linux' },
  ];

  private static readonly WINDOWS_LIBRARIES: Array<{ name: string; path: string; platform: 'win32' }> = [
    // Net iD
    { name: 'Net iD', path: 'C:\\Program Files\\Net iD\\iidp11.dll', platform: 'win32' },
    { name: 'Net iD', path: 'C:\\Program Files (x86)\\Net iD\\iidp11.dll', platform: 'win32' },
    // OpenSC
    {
      name: 'OpenSC',
      path: 'C:\\Program Files\\OpenSC Project\\OpenSC\\pkcs11\\onepin-opensc-pkcs11.dll',
      platform: 'win32',
    },
    {
      name: 'OpenSC',
      path: 'C:\\Program Files (x86)\\OpenSC Project\\OpenSC\\pkcs11\\onepin-opensc-pkcs11.dll',
      platform: 'win32',
    },
    {
      name: 'OpenSC',
      path: 'C:\\Program Files\\OpenSC Project\\OpenSC\\pkcs11\\opensc-pkcs11.dll',
      platform: 'win32',
    },
    {
      name: 'OpenSC',
      path: 'C:\\Program Files (x86)\\OpenSC Project\\OpenSC\\pkcs11\\opensc-pkcs11.dll',
      platform: 'win32',
    },
  ];

  /**
   * Returns a list of known default library paths for a given platform.
   */
  public static getKnownLibraryPaths(
    platform?: 'linux' | 'win32'
  ): Array<{ name: string; path: string; platform: 'linux' | 'win32' }> {
    const targetPlatform = platform ?? (process.platform === 'win32' ? 'win32' : 'linux');
    if (targetPlatform === 'win32') {
      return [...this.WINDOWS_LIBRARIES];
    }
    return [...this.LINUX_LIBRARIES];
  }

  /**
   * Validates whether a file exists at the given path and is a file.
   */
  public static async validateLibraryPath(libraryPath: string): Promise<boolean> {
    if (!libraryPath || typeof libraryPath !== 'string') {
      return false;
    }
    try {
      const stat = await fs.stat(libraryPath);
      return stat.isFile();
    } catch {
      return false;
    }
  }

  /**
   * Detects available smartcard PKCS#11 libraries on the system.
   */
  public static async detectAvailableLibraries(
    platform?: 'linux' | 'win32',
    options?: DetectOptions
  ): Promise<DetectedSmartcardLib[]> {
    const targetPlatform = platform ?? (process.platform === 'win32' ? 'win32' : 'linux');
    const candidates = options?.customPaths ?? this.getKnownLibraryPaths(targetPlatform);

    const results: DetectedSmartcardLib[] = await Promise.all(
      candidates.map(async (candidate) => {
        const exists = await this.validateLibraryPath(candidate.path);
        return {
          name: candidate.name,
          path: candidate.path,
          platform: candidate.platform,
          exists,
        };
      })
    );

    if (options?.onlyExisting) {
      return results.filter((lib) => lib.exists);
    }

    return results;
  }

  /**
   * Generates command-line arguments for OpenSSH (ssh) client.
   */
  public static buildSSHArguments(config: SSHConnectionConfig): string[] {
    if (!config.host || typeof config.host !== 'string' || config.host.startsWith('-')) {
      throw new Error('Invalid SSH host: host cannot start with "-"');
    }

    const port = config.port ?? 22;
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error('Invalid SSH port: port must be between 1 and 65535');
    }

    const args: string[] = [];

    // Port argument
    args.push('-p', String(port));

    // Smartcard PKCS#11 library argument (-I <path>)
    if (config.authType === 'smartcard' && config.pkcs11LibPath) {
      args.push('-I', config.pkcs11LibPath);
    }

    // Identity file / private key argument (-i <path>)
    if (config.privateKeyPath) {
      args.push('-i', config.privateKeyPath);
    }

    // Extra SSH options (-o Key=Value)
    if (config.extraOptions) {
      for (const [key, value] of Object.entries(config.extraOptions)) {
        args.push('-o', `${key}=${value}`);
      }
    }

    // Outgoing proxy option (-o ProxyCommand=...)
    if (config.proxy?.enabled && config.proxy.host) {
      const p = config.proxy;
      const port = p.port || (p.type === 'http' ? 8080 : 1080);
      if (p.username) {
        const cliPath = path.resolve(__dirname, '../proxy/proxyCli.cjs');
        args.push(
          '-o',
          `ProxyCommand=node "${cliPath}" ${p.type} ${p.host} ${port} %h %p "${p.username}" "${p.password || ''}"`
        );
      } else if (p.type === 'http') {
        args.push('-o', `ProxyCommand=nc -X connect -x ${p.host}:${port} %h %p`);
      } else if (p.type === 'socks5') {
        args.push('-o', `ProxyCommand=nc -X 5 -x ${p.host}:${port} %h %p`);
      } else if (p.type === 'socks4') {
        args.push('-o', `ProxyCommand=nc -X 4 -x ${p.host}:${port} %h %p`);
      }
    }

    // Destination target (username@host or host), preceded by '--' to prevent flag injection
    const destination = config.username ? `${config.username}@${config.host}` : config.host;
    args.push('--');
    args.push(destination);

    return args;
  }
}
