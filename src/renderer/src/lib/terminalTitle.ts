/* eslint-disable no-control-regex */
/**
 * Extracts a hostname from terminal window title escape sequences (OSC 0 / OSC 2).
 *
 * Shells (bash, zsh, fish) and terminal utilities routinely set window titles
 * via escape sequences like `\e]0;user@hostname: ~\a`.
 */

const DISALLOWED_PREFIXES = new Set([
  'http',
  'https',
  'ftp',
  'file',
  'ssh',
  'git',
  'vim',
  'nvim',
  'nano',
  'man',
  'less',
  'more',
  'grep',
  'cat',
  'node',
  'npm',
  'pnpm',
  'yarn',
  'cargo',
  'python',
  'python3',
  'bash',
  'zsh',
  'sh',
  'fish',
  'sudo',
  'su',
  'top',
  'htop',
  'btop',
  'tmux',
  'screen',
  'tail',
  'head',
  'watch',
  'docker',
  'podman',
  'kubectl',
  'make',
  'gcc',
  'g++',
  'clang',
  'ruby',
  'perl',
  'php',
  'find',
  'sed',
  'awk',
  'curl',
  'wget',
  'ping',
  'traceroute',
  'netstat',
  'ss',
  'ip',
  'df',
  'du',
  'ls',
  'cd',
  'dir',
  'echo',
  'clear',
  'reset',
  'exit',
  'logout',
  'terminal',
]);

const FILE_EXTENSIONS = /\.(txt|md|js|jsx|ts|tsx|json|yaml|yml|log|py|sh|c|h|cpp|go|rs|html|css|conf|ini|toml)$/i;

function isValidHostname(name: string): boolean {
  if (!name || name.length > 253) return false;
  const lower = name.toLowerCase();
  if (DISALLOWED_PREFIXES.has(lower)) return false;
  if (FILE_EXTENSIONS.test(name)) return false;
  return /^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(name);
}

/**
 * Extracts a valid remote or local hostname from raw terminal OSC title string or bare hostname.
 * Returns the hostname if recognized, or `null` if the title does not represent a host.
 */
export function extractHostnameFromTitle(rawTitle: string): string | null {
  if (!rawTitle || typeof rawTitle !== 'string') return null;
  const trimmed = rawTitle.trim();
  if (!trimmed) return null;

  // 1. Direct ssh command invocation in title:
  // e.g. "ssh user@host", "ssh host", "ssh -p 2222 host", "ssh -i id_rsa user@host"
  const sshMatch = trimmed.match(
    /(?:^|\s)ssh(?:\s+-[a-zA-Z0-9_.-]+(?:\s+[^\s]+)?)*\s+(?:[^\s@]+@)?([a-zA-Z0-9.-]+)/i
  );
  if (sshMatch) {
    const candidate = sshMatch[1];
    if (isValidHostname(candidate)) return candidate;
  }

  // 2. User@Host pattern, standard in bash/zsh PS1 prompts:
  // e.g. "user@myhost: ~", "(venv) user@myhost:/var/log", "root@10.0.0.1: ~", "user@host"
  const userHostMatch = trimmed.match(
    /(?:^|\s|\()(?:[a-zA-Z0-9._-]+@)([a-zA-Z0-9.-]+)(?::|\s|\)|$)/
  );
  if (userHostMatch) {
    const candidate = userHostMatch[1];
    if (isValidHostname(candidate)) return candidate;
  }

  // 3. Host with colon and path/prompt (without user@ prefix):
  // e.g. "myhost: ~", "myhost: /etc/nginx", "db-01:~"
  const hostColonMatch = trimmed.match(/(?:^|\s)([a-zA-Z0-9.-]+):(?:\s*[~/\\]|$)/);
  if (hostColonMatch) {
    const candidate = hostColonMatch[1];
    if (isValidHostname(candidate)) return candidate;
  }

  // 4. Bare valid hostname (e.g. emitted from scanOutputForHost or raw window title set to hostname)
  if (!trimmed.includes('/') && !trimmed.includes('\\') && !trimmed.includes(' ') && isValidHostname(trimmed)) {
    return trimmed;
  }

  return null;
}

/**
 * Extracts a hostname from a shell command string typed by the user (e.g. "ssh gnarg", "ssh user@remote -p 22").
 */
export function extractHostnameFromCommand(cmd: string): string | null {
  if (!cmd) return null;
  const trimmed = cmd.trim();
  // Match ssh command with optional flags: ssh [-flags...] [user@]hostname [cmd]
  const sshMatch = trimmed.match(
    /^ssh(?:\s+(?:-[a-zA-Z0-9_.-]+(?:\s+[^\s]+)?|-[a-zA-Z0-9]+))*\s+(?:[^\s@]+@)?([a-zA-Z0-9.-]+)/i
  );
  if (sshMatch) {
    const candidate = sshMatch[1];
    if (isValidHostname(candidate)) return candidate;
  }
  return null;
}

/**
 * Scans raw PTY output chunks for hostname cues (OSC sequences, directory reports, or shell prompt text).
 */
export function scanOutputForHost(chunk: string): string | null {
  if (!chunk || typeof chunk !== 'string') return null;

  // 1. Check OSC 0 or OSC 2 sequences: \x1b]0;...\x07 or \x1b]2;...\x07
  const oscMatch = chunk.match(/\x1b\][02];([^\x07\x1b]+)(?:\x07|\x1b\\)/);
  if (oscMatch) {
    const host = extractHostnameFromTitle(oscMatch[1]);
    if (host) return host;
  }

  // 2. Check OSC 7 (Current directory / host): \x1b]7;file://hostname/path
  const osc7Match = chunk.match(/\x1b\]7;file:\/\/([a-zA-Z0-9.-]+)\//i);
  if (osc7Match) {
    const candidate = osc7Match[1];
    if (isValidHostname(candidate) && candidate.toLowerCase() !== 'localhost') {
      return candidate;
    }
  }

  // 3. Check OSC 3008 (VTE / systemd notification): hostname=xxx;
  const osc3008Match = chunk.match(/\x1b\]3008;[^\x1b\x07]*hostname=([a-zA-Z0-9.-]+)/);
  if (osc3008Match) {
    const candidate = osc3008Match[1];
    if (isValidHostname(candidate)) return candidate;
  }

  // 4. Strip ANSI escape sequences to inspect prompt text
  const stripped = chunk.replace(
    /\x1b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\].*?(?:\x07|\x1b\\))/g,
    ''
  );

  // Check for prompt pattern user@hostname in the chunk
  // e.g. "alun@gnarg in ~", "[alun@gnarg ~]$", "root@gnarg:~#", "alun@gnarg %"
  const promptMatch = stripped.match(
    /(?:^|[\r\n\s╭[(])([a-zA-Z0-9._-]+)@([a-zA-Z0-9.-]+)(?:[\s:]|[\])>❯#%$])/
  );
  if (promptMatch) {
    const candidate = promptMatch[2];
    if (isValidHostname(candidate)) return candidate;
  }

  return null;
}

/**
 * Normalizes host strings for comparison (e.g. ignores case and domain suffix if short host matches).
 */
export function isSameHost(hostA?: string, hostB?: string): boolean {
  if (!hostA || !hostB) return false;
  const a = hostA.toLowerCase().trim();
  const b = hostB.toLowerCase().trim();
  if (a === b) return true;
  // If one is short hostname and the other is FQDN (e.g. "web01" vs "web01.internal.corp")
  const aShort = a.split('.')[0];
  const bShort = b.split('.')[0];
  return aShort === bShort;
}
