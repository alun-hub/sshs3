import { parsePublicKeyLines } from '../ssh/PublicKeyUtils';
import type { LocalPublicKey } from '../../shared/types/ssh';
import type { FetchGitKeysRequest, FetchGitKeysResult, GitKeyProvider } from '../../shared/types/git';

const USERNAME_REGEX = /^[a-zA-Z0-9_.-]+$/;
const MAX_RESPONSE_BYTES = 64 * 1024;
const FETCH_TIMEOUT_MS = 8000;

function isValidHost(host: string): boolean {
  const [hostname, port] = host.split(':');
  if (!hostname || !/^[a-zA-Z0-9.-]+$/.test(hostname)) return false;
  if (port !== undefined) {
    const p = Number(port);
    if (!/^\d{1,5}$/.test(port) || p < 1 || p > 65535) return false;
  }
  return true;
}

/** Checks if a host is a private/loopback/cloud-metadata address (SSRF prevention). */
export function isPrivateOrBlockedHost(host: string): boolean {
  let clean = host.toLowerCase().trim();
  if (clean.startsWith('[') && clean.includes(']')) {
    clean = clean.slice(1, clean.indexOf(']'));
  } else if (clean.includes(':') && !clean.includes('::')) {
    clean = clean.split(':')[0];
  }
  if (
    clean === 'localhost' ||
    clean === '127.0.0.1' ||
    clean === '::1' ||
    clean === '0.0.0.0' ||
    clean === '169.254.169.254' ||
    clean.endsWith('.local') ||
    clean.endsWith('.internal')
  ) {
    return true;
  }
  // Check IPv4 private ranges
  const parts = clean.split('.').map(Number);
  if (parts.length === 4 && parts.every((p) => !isNaN(p) && p >= 0 && p <= 255)) {
    if (parts[0] === 10) return true; // 10.0.0.0/8
    if (parts[0] === 127) return true; // 127.0.0.0/8
    if (parts[0] === 169 && parts[1] === 254) return true; // 169.254.0.0/16
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true; // 172.16.0.0/12
    if (parts[0] === 192 && parts[1] === 168) return true; // 192.168.0.0/16
  }
  return false;
}

export function buildGitKeysUrl(provider: GitKeyProvider, username: string, customHost?: string): string {
  const cleanUser = encodeURIComponent(username.trim());
  if (provider === 'github') {
    return `https://github.com/${cleanUser}.keys`;
  }
  if (provider === 'gitlab') {
    return `https://gitlab.com/${cleanUser}.keys`;
  }
  if (provider === 'custom') {
    if (!customHost || !customHost.trim()) {
      throw new Error('A custom host is required for custom Git provider');
    }
    let host = customHost.trim();
    if (host.startsWith('https://')) {
      host = host.slice('https://'.length);
    } else if (host.startsWith('http://')) {
      throw new Error('Only secure HTTPS is allowed for Git key fetching');
    }
    host = host.replace(/\/+$/, '');
    if (!isValidHost(host)) {
      throw new Error('Invalid host format');
    }
    if (isPrivateOrBlockedHost(host)) {
      throw new Error('Fetching from local/private network hosts is blocked for security');
    }
    return `https://${host}/${cleanUser}.keys`;
  }
  throw new Error(`Unsupported Git provider: ${provider}`);
}

export function buildGitKeysInstallCommands(url: string): { bash: string; powershell: string } {
  return {
    bash: `curl -fsSL ${url} | (mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys)`,
    powershell: `if (!(Test-Path $HOME\\.ssh)) { New-Item -ItemType Directory -Path $HOME\\.ssh }; (Invoke-WebRequest -Uri "${url}").Content | Out-File -Append -Encoding ascii -FilePath $HOME\\.ssh\\authorized_keys`,
  };
}

export async function fetchGitPublicKeys(request: FetchGitKeysRequest): Promise<FetchGitKeysResult> {
  const username = request.username?.trim();
  if (!username) {
    return { success: false, keys: [], error: 'Username is required' };
  }
  if (username.length > 100 || !USERNAME_REGEX.test(username)) {
    return { success: false, keys: [], error: 'Invalid username format' };
  }

  let url: string;
  try {
    url = buildGitKeysUrl(request.provider, username, request.customHost);
  } catch (err) {
    return { success: false, keys: [], error: err instanceof Error ? err.message : String(err) };
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'sshs3-client/1.0',
        Accept: 'text/plain',
      },
    }).finally(() => clearTimeout(timer));

    if (response.status === 404) {
      return { success: false, keys: [], error: `User '${username}' not found on ${request.provider}` };
    }
    if (!response.ok) {
      return { success: false, keys: [], error: `Failed to fetch keys: HTTP ${response.status} ${response.statusText}` };
    }

    const text = await response.text();
    if (text.length > MAX_RESPONSE_BYTES) {
      return { success: false, keys: [], error: 'Response exceeded maximum allowed size (64 KB)' };
    }

    const parsed = parsePublicKeyLines(text);
    if (parsed.length === 0) {
      return { success: true, keys: [], error: `No public keys found for '${username}'` };
    }

    const source = request.provider === 'github' ? 'github' : request.provider === 'gitlab' ? 'gitlab' : 'git-custom';
    const keys: LocalPublicKey[] = parsed.map((p, idx) => ({
      id: p.fingerprint || `${source}:${username}:${idx}`,
      line: p.line,
      type: p.type,
      fingerprint: p.fingerprint,
      comment: p.comment || `${username}@${request.provider}`,
      source,
      label: `${username} (${request.provider}) [${p.type}]`,
    }));

    return { success: true, keys };
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { success: false, keys: [], error: 'Request timed out after 8 seconds' };
    }
    return {
      success: false,
      keys: [],
      error: `Failed to fetch public keys: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
