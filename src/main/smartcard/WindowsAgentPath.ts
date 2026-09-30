import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { withPkcs11Lock } from './Pkcs11Lock';

const execFileAsync = promisify(execFile);

/**
 * Windows-only: lets a PKCS#11 module whose own folder holds the DLLs it depends on (e.g. Yubico's
 * `libykcs11.dll`, which needs `libcrypto-3-x64.dll`/`libykpiv.dll`/`zlib1.dll` beside it) be loaded by the
 * Windows "OpenSSH Authentication Agent" service.
 *
 * That service runs as LocalSystem and only sees the *machine* PATH, so when the module's folder isn't on it
 * the agent's `ssh-pkcs11-helper` fails `LoadLibrary` and `ssh-add -s` reports just "agent refused operation"
 * — before a PIN ever reaches the card. OpenSC is unaffected (its module is self-contained).
 */

const MACHINE_ENV_KEY = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment';

function normalizeDir(dir: string): string {
  return dir.trim().replace(/[\\/]+$/, '').replace(/\//g, '\\').toLowerCase();
}

/** True when `dir` is one of the `;`-separated entries of a PATH value (case-insensitive, slash/trailing-slash tolerant). */
export function isDirOnPath(dir: string, pathValue: string): boolean {
  const wanted = normalizeDir(dir);
  return pathValue
    .split(';')
    .map(normalizeDir)
    .some((entry) => entry !== '' && entry === wanted);
}

/** Expands `%VAR%` references the way Windows does when it builds a service's environment. */
function expandEnvVars(value: string): string {
  return value.replace(/%([^%]+)%/g, (whole, name: string) => process.env[name] ?? whole);
}

/** The machine-wide PATH (what the ssh-agent service inherits), expanded, read from the registry — no admin needed. */
async function getMachinePath(): Promise<string> {
  const { stdout } = await execFileAsync('reg.exe', ['query', MACHINE_ENV_KEY, '/v', 'Path'], { timeout: 10000 });
  const match = /^\s*Path\s+REG_(?:EXPAND_)?SZ\s+(.*)$/im.exec(stdout);
  return expandEnvVars(match?.[1]?.trim() ?? '');
}

export interface WindowsAgentPathStatus {
  /** False off Windows or when the library file is missing — nothing to show. */
  applicable: boolean;
  /** The module can't be loaded with only the machine PATH, which is the agent service's view of the world. */
  needsFix: boolean;
  /** Folder that would be added to the machine PATH. */
  libDir?: string;
}

/**
 * Empirically checks whether the module loads under the agent service's PATH: runs `ssh-keygen -D <lib>` (which
 * loads it through the same `ssh-pkcs11-helper`, and needs no PIN — public certificates only) with PATH reduced
 * to the machine PATH, and looks for OpenSSH's `dlopen ... failed`. Other failures (e.g. no card present) are
 * deliberately *not* treated as "needs fix".
 */
export async function getWindowsAgentPathStatus(pkcs11LibPath: string): Promise<WindowsAgentPathStatus> {
  if (process.platform !== 'win32' || !pkcs11LibPath) return { applicable: false, needsFix: false };

  const libDir = path.dirname(pkcs11LibPath);
  let machinePath: string;
  try {
    machinePath = await getMachinePath();
  } catch {
    return { applicable: false, needsFix: false };
  }
  if (isDirOnPath(libDir, machinePath)) return { applicable: true, needsFix: false, libDir };

  const sshKeygen = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'OpenSSH', 'ssh-keygen.exe');
  try {
    // Same lock as every other PKCS#11 access: never race a concurrent ssh-add/cert read on the token.
    await withPkcs11Lock(() =>
      execFileAsync(sshKeygen, ['-D', pkcs11LibPath], {
        timeout: 15000,
        env: { ...process.env, PATH: machinePath },
      })
    );
    return { applicable: true, needsFix: false, libDir };
  } catch (err) {
    const output = `${(err as { stdout?: string }).stdout ?? ''}${(err as { stderr?: string }).stderr ?? ''}`;
    return { applicable: true, needsFix: /dlopen .* failed/i.test(output), libDir };
  }
}

/** Single-quotes a string for PowerShell (only `'` needs escaping, by doubling it). */
function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Appends the module's folder to the *machine* PATH and restarts the ssh-agent service so it picks it up. Needs
 * administrator rights, so it runs in an elevated PowerShell behind a UAC prompt (declining rejects). The caller
 * must already have verified `libDir` belongs to a known PKCS#11 module — this is a system-wide change.
 */
export async function applyWindowsAgentPathFix(libDir: string): Promise<void> {
  if (process.platform !== 'win32') throw new Error('Only available on Windows.');

  const inner = [
    `$d = ${psQuote(libDir)}`,
    `$key = Get-Item 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment'`,
    // Read unexpanded so %SystemRoot% etc. entries survive the rewrite, and write back as REG_EXPAND_SZ.
    `$cur = $key.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)`,
    `$has = ($cur -split ';' | ForEach-Object { $_.TrimEnd('\\') }) -contains $d.TrimEnd('\\')`,
    `if (-not $has) { Set-ItemProperty -Path $key.PSPath -Name Path -Value ($cur.TrimEnd(';') + ';' + $d) -Type ExpandString }`,
    `if ((Get-Service ssh-agent).StartType -eq 'Disabled') { Set-Service ssh-agent -StartupType Automatic }`,
    `Restart-Service ssh-agent -Force`,
  ].join('; ');
  const encoded = Buffer.from(inner, 'utf16le').toString('base64');

  // The elevated child's own exit code is what we care about; Start-Process throws if UAC is declined.
  const outer =
    `$p = Start-Process -FilePath powershell.exe -Verb RunAs -Wait -PassThru -WindowStyle Hidden ` +
    `-ArgumentList '-NoProfile','-EncodedCommand',${psQuote(encoded)}; exit $p.ExitCode`;
  try {
    await execFileAsync('powershell.exe', ['-NoProfile', '-Command', outer], { timeout: 120000 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/canceled by the user|avbröts av användaren/i.test(msg)) {
      throw new Error('The administrator prompt was declined — nothing was changed.', { cause: err });
    }
    throw new Error(`Could not update the system PATH: ${msg}`, { cause: err });
  }
}
