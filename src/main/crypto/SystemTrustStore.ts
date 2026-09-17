import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import tls from 'node:tls';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const execFileAsync = promisify(execFile);

export const LINUX_CA_BUNDLE_PATHS = [
  '/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem', // Fedora / RHEL / CentOS / Rocky
  '/etc/ssl/certs/ca-certificates.crt',               // Debian / Ubuntu / Gentoo
  '/etc/pki/tls/certs/ca-bundle.crt',                 // RHEL/Fedora legacy
  '/etc/ssl/ca-bundle.pem',                           // openSUSE / SUSE
  '/etc/ssl/cert.pem',                                // Arch / Alpine / macOS
  '/etc/pki/tls/cert.pem',
];

export class SystemTrustStore {
  private static cachedCAs: string[] = [];
  private static cachedBundlePath?: string;
  private static isInitialized = false;

  /**
   * Initializes the system trust store by locating and reading system CA certificates.
   */
  public static async init(): Promise<void> {
    if (this.isInitialized) return;

    try {
      if (process.platform === 'win32') {
        await this.loadWindowsCertificates();
      } else {
        await this.loadLinuxCertificates();
      }

      // If we found a valid CA bundle file and NODE_EXTRA_CA_CERTS is not set, set it
      if (this.cachedBundlePath && !process.env.NODE_EXTRA_CA_CERTS) {
        process.env.NODE_EXTRA_CA_CERTS = this.cachedBundlePath;
      }
    } catch (err) {
      console.warn('SystemTrustStore: failed to load system CA certificates:', err);
    } finally {
      this.isInitialized = true;
    }
  }

  /**
   * Returns parsed system CA certificates (PEM strings).
   */
  public static getCAs(): string[] {
    if (!this.isInitialized) {
      this.initSync();
    }
    return this.cachedCAs;
  }

  /**
   * Returns the path to the system CA bundle file if one exists on disk.
   */
  public static getBundlePath(): string | undefined {
    if (!this.isInitialized) {
      this.initSync();
    }
    return this.cachedBundlePath;
  }

  /**
   * Returns merged root certificates combining Node's default Mozilla trust store
   * with the system's CA certificates.
   */
  public static getMergedRootCertificates(): (string | Buffer)[] {
    const sysCAs = this.getCAs();
    if (!sysCAs || sysCAs.length === 0) {
      return [...tls.rootCertificates];
    }
    return [...tls.rootCertificates, ...sysCAs];
  }

  /**
   * Synchronous initialization fallback for early startup code.
   */
  public static initSync(): void {
    if (this.isInitialized) return;

    try {
      if (process.platform === 'win32') {
        this.loadWindowsCertificatesSync();
      } else {
        this.loadLinuxCertificatesSync();
      }

      if (this.cachedBundlePath && !process.env.NODE_EXTRA_CA_CERTS) {
        process.env.NODE_EXTRA_CA_CERTS = this.cachedBundlePath;
      }
    } catch (err) {
      console.warn('SystemTrustStore: failed to sync load system CA certificates:', err);
    } finally {
      this.isInitialized = true;
    }
  }

  /**
   * Splits a multi-certificate PEM bundle into individual certificate strings.
   */
  public static splitPemBundle(pemContent: string): string[] {
    const certs: string[] = [];
    const certRegex = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g;
    let match: RegExpExecArray | null;
    while ((match = certRegex.exec(pemContent)) !== null) {
      certs.push(match[0].trim());
    }
    return certs;
  }

  /**
   * Finds the first existing Linux CA bundle path.
   */
  public static findLinuxBundlePath(): string | undefined {
    for (const candidate of LINUX_CA_BUNDLE_PATHS) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
    return undefined;
  }

  private static async loadLinuxCertificates(): Promise<void> {
    const bundlePath = this.findLinuxBundlePath();
    if (!bundlePath) return;

    this.cachedBundlePath = bundlePath;
    const content = await fs.promises.readFile(bundlePath, 'utf8');
    this.cachedCAs = this.splitPemBundle(content);
  }

  private static loadLinuxCertificatesSync(): void {
    const bundlePath = this.findLinuxBundlePath();
    if (!bundlePath) return;

    this.cachedBundlePath = bundlePath;
    const content = fs.readFileSync(bundlePath, 'utf8');
    this.cachedCAs = this.splitPemBundle(content);
  }

  /**
   * Fetches Windows root and intermediate CA certificates directly from
   * the Windows Certificate Store using native CryptoAPI (crypt32.dll) via win-ca.
   * This is fast, does not spawn external processes, and works even if PowerShell is
   * blocked by AppLocker/GPO or restricted execution policies.
   */
  public static fetchWindowsCertificatesNative(): string[] {
    try {
      const ca = require('win-ca/api');
      const list: string[] = [];
      ca({
        store: ['root', 'ca'],
        format: ca.der2.pem,
        ondata: list,
      });
      return list.filter((c) => typeof c === 'string' && c.trim().length > 0);
    } catch (err) {
      console.warn('SystemTrustStore: win-ca native CryptoAPI extraction failed:', err);
      return [];
    }
  }

  /**
   * Loads Windows root and intermediate certificates from the Windows Certificate Store.
   * Uses native CryptoAPI (win-ca) primarily, falling back to PowerShell if needed.
   * Caches extracted PEM bundle in ~/.sshs3/windows-ca-bundle.pem.
   */
  private static async loadWindowsCertificates(): Promise<void> {
    const cacheDir = path.join(os.homedir(), '.sshs3');
    const cacheFile = path.join(cacheDir, 'windows-ca-bundle.pem');

    // Use cached bundle if fresh (younger than 24 hours)
    if (fs.existsSync(cacheFile)) {
      try {
        const stats = await fs.promises.stat(cacheFile);
        const ageHours = (Date.now() - stats.mtimeMs) / (1000 * 60 * 60);
        if (ageHours < 24 && stats.size > 0) {
          const cached = await fs.promises.readFile(cacheFile, 'utf8');
          const certs = this.splitPemBundle(cached);
          if (certs.length > 0) {
            this.cachedBundlePath = cacheFile;
            this.cachedCAs = certs;
            return;
          }
        }
      } catch {
        // Cache read failed, regenerate
      }
    }

    // 1. Primary: Direct Windows Certificate Store access via CryptoAPI (win-ca)
    // Avoids spawning PowerShell, immune to AppLocker/GPO PowerShell execution blocks, fast and silent.
    const nativeCerts = this.fetchWindowsCertificatesNative();
    if (nativeCerts.length > 0) {
      this.cachedCAs = nativeCerts;
      const pemBundle = nativeCerts.join('\r\n');
      try {
        if (!fs.existsSync(cacheDir)) {
          await fs.promises.mkdir(cacheDir, { recursive: true });
        }
        await fs.promises.writeFile(cacheFile, pemBundle, 'utf8');
        this.cachedBundlePath = cacheFile;
      } catch {
        // Non-fatal if writing cache fails
      }
      return;
    }

    // 2. Secondary fallback: Query Windows Certificate Store via PowerShell if native call was empty/failed
    const psScript =
      '$certs = Get-ChildItem -Path Cert:\\LocalMachine\\Root, Cert:\\CurrentUser\\Root, Cert:\\LocalMachine\\CA -ErrorAction SilentlyContinue | ' +
      'Where-Object { $_.RawData } | ' +
      'ForEach-Object { "-----BEGIN CERTIFICATE-----`r`n" + [System.Convert]::ToBase64String($_.RawData, "InsertLineBreaks") + "`r`n-----END CERTIFICATE-----" }; ' +
      '[System.String]::Join("`r`n", $certs)';

    try {
      const { stdout } = await execFileAsync('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        psScript,
      ]);

      const certs = this.splitPemBundle(stdout);
      if (certs.length > 0) {
        this.cachedCAs = certs;
        try {
          if (!fs.existsSync(cacheDir)) {
            await fs.promises.mkdir(cacheDir, { recursive: true });
          }
          await fs.promises.writeFile(cacheFile, stdout, 'utf8');
          this.cachedBundlePath = cacheFile;
        } catch {
          // Non-fatal if writing cache fails
        }
      }
    } catch (err) {
      console.warn('SystemTrustStore: PowerShell cert extraction fallback failed:', err);
    }
  }

  private static loadWindowsCertificatesSync(): void {
    const cacheDir = path.join(os.homedir(), '.sshs3');
    const cacheFile = path.join(cacheDir, 'windows-ca-bundle.pem');

    if (fs.existsSync(cacheFile)) {
      try {
        const cached = fs.readFileSync(cacheFile, 'utf8');
        const certs = this.splitPemBundle(cached);
        if (certs.length > 0) {
          this.cachedBundlePath = cacheFile;
          this.cachedCAs = certs;
          return;
        }
      } catch {
        // Ignore
      }
    }

    const nativeCerts = this.fetchWindowsCertificatesNative();
    if (nativeCerts.length > 0) {
      this.cachedCAs = nativeCerts;
      this.cachedBundlePath = cacheFile;
      try {
        if (!fs.existsSync(cacheDir)) {
          fs.mkdirSync(cacheDir, { recursive: true });
        }
        fs.writeFileSync(cacheFile, nativeCerts.join('\r\n'), 'utf8');
      } catch {
        // Ignore
      }
    }
  }

  /**
   * Resets internal cache (for testing).
   */
  public static _reset(): void {
    this.cachedCAs = [];
    this.cachedBundlePath = undefined;
    this.isInitialized = false;
  }
}
