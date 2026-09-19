import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DetectedSmartcardLib, SSHConnectionConfig } from '../../shared/types/ssh';

export interface DetectOptions {
  customPaths?: Array<{ name: string; path: string; platform: 'linux' | 'win32' }>;
  onlyExisting?: boolean;
}

export class SmartcardDetector {
  private static readonly LINUX_LIBRARIES: Array<{ name: string; path: string; platform: 'linux' }> = [
    // p11-kit (prioritized: proxies all system-registered PKCS#11 modules)
    { name: 'p11-kit', path: '/usr/lib64/p11-kit-proxy.so', platform: 'linux' },
    { name: 'p11-kit', path: '/usr/lib/x86_64-linux-gnu/p11-kit-proxy.so', platform: 'linux' },
    { name: 'p11-kit', path: '/usr/lib/p11-kit-proxy.so', platform: 'linux' },
    { name: 'p11-kit', path: '/usr/local/lib/p11-kit-proxy.so', platform: 'linux' },
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

    // Jump host / ProxyJump (-J <proxyJump>)
    if (config.proxyJump && config.proxyJump.trim()) {
      args.push('-J', config.proxyJump.trim());
    }

    // Smartcard authentication
    if (config.authType === 'smartcard' && config.pkcs11LibPath) {
      console.log(
        `[smartcard] buildSSHArguments: authType=smartcard, agentPath=${config.agentPath ?? '(none — using direct -I)'}`
      );
      if (config.agentPath) {
        // A private agent was pre-loaded with the smartcard's key (agent-per-session
        // mode) — authenticate through it instead of a second direct PKCS#11 login,
        // so the PIN is only entered once for the whole session. Deliberately no
        // IdentitiesOnly here: that option restricts ssh to *explicitly configured*
        // identity files, hiding whatever the agent offers (including our just-loaded
        // smartcard key) unless separately referenced with -i — the opposite of what
        // we want. It's safe to let ssh use whatever this agent offers since it's our
        // own private, freshly-spawned agent holding only this one key.
        args.push('-o', `IdentityAgent=${config.agentPath}`);
      } else {
        args.push('-I', config.pkcs11LibPath);
        // Prevent the desktop's own ssh-agent/wallet (e.g. gnome-keyring, KWallet)
        // from independently prompting for the same smartcard's PIN alongside
        // our own askpass-driven -I flow.
        args.push('-o', 'IdentitiesOnly=yes');
        args.push('-o', 'IdentityAgent=none');
      }
    }

    // Identity file / private key argument (-i <path>)
    if (config.privateKeyPath) {
      args.push('-i', config.privateKeyPath);
    }

    // SSH Agent forwarding (-o ForwardAgent=yes/no)
    if (config.forwardAgent !== undefined) {
      args.push('-o', `ForwardAgent=${config.forwardAgent ? 'yes' : 'no'}`);
    }

    // Compression (-o Compression=yes/no)
    if (config.compression !== undefined) {
      args.push('-o', `Compression=${config.compression ? 'yes' : 'no'}`);
    }

    // ServerAliveInterval (-o ServerAliveInterval=...)
    if (config.serverAliveInterval && config.serverAliveInterval > 0) {
      args.push('-o', `ServerAliveInterval=${config.serverAliveInterval}`);
    }

    // Ciphers (-o Ciphers=...)
    if (config.ciphers?.trim()) {
      args.push('-o', `Ciphers=${config.ciphers.trim()}`);
    }

    // KexAlgorithms (-o KexAlgorithms=...)
    if (config.kexAlgorithms?.trim()) {
      args.push('-o', `KexAlgorithms=${config.kexAlgorithms.trim()}`);
    }

    // MACs (-o MACs=...)
    if (config.macs?.trim()) {
      args.push('-o', `MACs=${config.macs.trim()}`);
    }

    // SSH Tunnels (Port forwarding: -L, -R, -D)
    if (config.tunnels && config.tunnels.length > 0) {
      for (const tunnel of config.tunnels) {
        if (tunnel.enabled === false) continue;
        if (tunnel.type === 'local') {
          args.push('-L', `${tunnel.localPort}:${tunnel.remoteHost || 'localhost'}:${tunnel.remotePort || 80}`);
        } else if (tunnel.type === 'remote') {
          args.push('-R', `${tunnel.localPort}:${tunnel.remoteHost || 'localhost'}:${tunnel.remotePort || 80}`);
        } else if (tunnel.type === 'dynamic') {
          args.push('-D', String(tunnel.localPort));
        }
      }
    }

    // Extra SSH options (-o Key=Value)
    if (config.extraOptions) {
      for (const [key, value] of Object.entries(config.extraOptions)) {
        args.push('-o', `${key}=${value}`);
      }
    }

    // Outgoing proxy option (-o ProxyCommand=...)
    // Always routed through proxyCli.cjs (a small Node script that speaks the
    // HTTP/SOCKS4/SOCKS5 handshake itself) rather than the external `nc`
    // binary, since `nc` isn't available on Windows and isn't guaranteed
    // elsewhere either.
    if (config.proxy?.enabled && config.proxy.host) {
      const p = config.proxy;
      const port = p.port || (p.type === 'http' ? 8080 : 1080);
      const currentDir =
        typeof __dirname !== 'undefined'
          ? __dirname
          : path.dirname(fileURLToPath(import.meta.url));
      const devPath = path.resolve(currentDir, '../proxy/proxyCli.cjs');
      const distPath = path.resolve(currentDir, 'proxyCli.cjs');
      const cliPath = fsSync.existsSync(distPath) ? distPath : devPath;
      args.push(
        '-o',
        `ProxyCommand=node "${cliPath}" ${p.type} ${p.host} ${port} %h %p "${p.username || ''}" "${p.password || ''}"`
      );
    }

    // Destination target (username@host or host), preceded by '--' to prevent flag injection
    const destination = config.username ? `${config.username}@${config.host}` : config.host;
    args.push('--');
    args.push(destination);

    return args;
  }
}
