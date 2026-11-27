import { execFile } from 'node:child_process';

/**
 * Env vars commonly used to point CLI tools (oc, kubectl, curl, git, aws,
 * pip, ...) at a custom/internal CA bundle. When an org relies on one of
 * these being exported from a shell profile (.bashrc/.zshrc/.profile)
 * rather than installed into the OS trust store, a GUI-launched app never
 * sees it (see comment in createShellSession below) and TLS verification
 * against internal hosts fails silently until the user works around it
 * with "skip TLS verify".
 */
const TRUST_RELEVANT_VARS = [
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'CURL_CA_BUNDLE',
  'REQUESTS_CA_BUNDLE',
  'NODE_EXTRA_CA_CERTS',
  'GIT_SSL_CAINFO',
  'AWS_CA_BUNDLE',
  'PIP_CERT',
  'SSH_AUTH_SOCK',
  'SSH_AGENT_PID',
];

/** The only PATH directories macOS gives an app started from Finder or the Dock. */
const MAC_GUI_PATH_DIRS = new Set(['/usr/bin', '/bin', '/usr/sbin', '/sbin']);

/**
 * The PATH for a macOS app started from Finder: the login shell's PATH (where Homebrew and the like are), followed by
 * any current directory it lacks. Undefined, meaning "leave PATH alone", when the current PATH has other directories
 * (started from a terminal, or set on purpose) or the shell gave nothing usable. Empty and relative entries are
 * dropped, since they would look up programs in the current directory.
 */
export function macGuiPath(currentPath: string | undefined, loginPath: string | undefined): string | undefined {
  const current = (currentPath ?? '').split(':').filter(Boolean);
  if (current.some((dir) => !MAC_GUI_PATH_DIRS.has(dir))) return undefined;
  const login = (loginPath ?? '').split(':').filter((dir) => dir.startsWith('/'));
  if (login.length === 0) return undefined;
  return [...new Set([...login, ...current])].join(':');
}

let cachedEnv: Record<string, string> | undefined;
let resolvePromise: Promise<Record<string, string>> | undefined;

/**
 * Resolves the environment the user's real login shell would have, by
 * spawning it as an interactive login shell and dumping `env`. This is how
 * apps launched from a GUI/.desktop entry (which bypass .bashrc/.zshrc/
 * .profile) recover shell-exported settings such as a custom CA bundle
 * path, the way they would if the same command were typed in a terminal.
 *
 * Not applicable on Windows, which has no such launcher/shell env gap.
 */
export async function resolveLoginShellEnv(): Promise<Record<string, string>> {
  if (process.platform === 'win32') return (cachedEnv ??= {});
  if (cachedEnv) return cachedEnv;
  if (resolvePromise) return resolvePromise;

  const shell = process.env.SHELL || '/bin/bash';

  resolvePromise = new Promise<Record<string, string>>((resolve) => {
    execFile(
      shell,
      ['-ilc', 'env -0'],
      { timeout: 5000, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => {
        if (err || !stdout) {
          resolve({});
          return;
        }
        const env: Record<string, string> = {};
        for (const entry of stdout.split('\0')) {
          const idx = entry.indexOf('=');
          if (idx <= 0) continue;
          env[entry.slice(0, idx)] = entry.slice(idx + 1);
        }
        resolve(env);
      }
    );
  });

  cachedEnv = await resolvePromise;
  return cachedEnv;
}

/**
 * Backfills `process.env` with trust and agent vars from the user's login
 * shell whenever this process was started without them (i.e. launched from a
 * GUI/.desktop entry rather than a terminal). Existing values are never
 * overwritten, so a terminal-launched app or one that already set these
 * deliberately is left untouched. The one exception is the bare PATH of a
 * macOS app started from Finder, see macGuiPath.
 */
export async function applyLoginShellEnv(platform: NodeJS.Platform = process.platform): Promise<void> {
  const shellEnv = await resolveLoginShellEnv();
  if (platform === 'darwin') {
    const guiPath = macGuiPath(process.env.PATH, shellEnv.PATH);
    if (guiPath !== undefined) process.env.PATH = guiPath;
  }
  for (const key of TRUST_RELEVANT_VARS) {
    if (process.env[key] === undefined && shellEnv[key] !== undefined) {
      process.env[key] = shellEnv[key];
    }
  }
}

/** Resets internal cache (for testing). */
export function _resetLoginShellEnvCache(): void {
  cachedEnv = undefined;
  resolvePromise = undefined;
}
