import { isValidRegion, isValidSsoConfig, normalizeStartUrl, sanitizeAwsText } from './ssm';
import type { AwsNetworkSettings, AwsSignIn, AwsSsoNetworkOptions } from './types/aws';

/**
 * Pure helpers for the AWS settings: sign-ins from policy and from the user, default regions and the AWS network
 * options. Everything that comes from policy or from a settings file is validated here, not trusted.
 */

const MAX_REGIONS = 30;
const MAX_MANAGED = 50;

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'signin';
}

/**
 * Sign-ins an administrator provides through policy: `Name|https://d-….awsapps.com/start|us-east-1`, entries
 * separated by `;` or newlines. A bad entry is dropped with a warning; the rest still applies.
 */
export function parseManagedSignIns(text: string | undefined): { items: AwsSignIn[]; warnings: string[] } {
  const items: AwsSignIn[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  for (const raw of (text ?? '').split(/[;\r\n]+/)) {
    const entry = raw.trim();
    if (!entry) continue;
    if (items.length >= MAX_MANAGED) {
      warnings.push(`Only the first ${MAX_MANAGED} managed AWS sign-ins are used.`);
      break;
    }
    const [name, url, region, ...rest] = entry.split('|').map((p) => p.trim());
    const startUrl = normalizeStartUrl(url ?? '');
    const clean = sanitizeAwsText(name, 60);
    if (rest.length > 0 || !clean || !region || !isValidSsoConfig({ startUrl, region })) {
      warnings.push(`Managed AWS sign-in "${sanitizeAwsText(entry, 40)}" ignored: expected Name|https://start-url|region.`);
      continue;
    }
    let id = `managed-${slug(clean)}`;
    for (let n = 2; seen.has(id); n++) id = `managed-${slug(clean)}-${n}`;
    seen.add(id);
    items.push({ id, name: clean, startUrl, region, managed: true });
  }
  return { items, warnings };
}

/** Policy-provided sign-ins first (locked), then the user's own; a user entry for the same start URL and region is hidden. */
export function allSignIns(user: readonly AwsSignIn[] | undefined, managedText: string | undefined): AwsSignIn[] {
  const managed = parseManagedSignIns(managedText).items;
  const taken = new Set(managed.map((m) => `${m.startUrl}\u0000${m.region}`));
  const own = sanitizeSignIns(user).filter((u) => !taken.has(`${u.startUrl}\u0000${u.region}`));
  return [...managed, ...own];
}

/** Validates a user-edited sign-in list from a settings file: drops invalid entries, keeps known fields only. */
export function sanitizeSignIns(list: unknown): AwsSignIn[] {
  if (!Array.isArray(list)) return [];
  const out: AwsSignIn[] = [];
  const ids = new Set<string>();
  for (const item of list.slice(0, 100)) {
    if (typeof item !== 'object' || item === null) continue;
    const o = item as Record<string, unknown>;
    const startUrl = typeof o.startUrl === 'string' ? normalizeStartUrl(o.startUrl) : '';
    const region = typeof o.region === 'string' ? o.region : '';
    const name = sanitizeAwsText(o.name, 60);
    if (!name || !isValidSsoConfig({ startUrl, region })) continue;
    let id = typeof o.id === 'string' && /^[\w.-]{1,64}$/.test(o.id) && !o.id.startsWith('managed-') ? o.id : '';
    if (!id || ids.has(id)) id = `signin-${out.length + 1}-${slug(name)}`;
    ids.add(id);
    out.push({
      id,
      name,
      startUrl,
      region,
      lastAccountId: typeof o.lastAccountId === 'string' && /^\d{12}$/.test(o.lastAccountId) ? o.lastAccountId : undefined,
      lastRoleName: typeof o.lastRoleName === 'string' && /^[\w+=,.@-]{1,64}$/.test(o.lastRoleName) ? o.lastRoleName : undefined,
    });
  }
  return out;
}

/** "eu-north-1, eu-west-1" → valid, de-duplicated region ids (invalid ones are dropped). */
export function parseRegionList(text: string | undefined): string[] {
  const out: string[] = [];
  for (const part of (text ?? '').split(/[\s,;]+/)) {
    if (part && isValidRegion(part) && !out.includes(part)) out.push(part);
    if (out.length >= MAX_REGIONS) break;
  }
  return out;
}

/** A `http(s)://host:port` proxy without credentials; anything else is rejected. */
export function parseHttpsProxy(value: string | undefined): { host: string; port: number; secure: boolean } | undefined {
  if (!value) return undefined;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return undefined;
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password || !url.hostname) return undefined;
  if (url.pathname !== '/' && url.pathname !== '') return undefined;
  const secure = url.protocol === 'https:';
  const port = url.port ? Number(url.port) : secure ? 443 : 80;
  if (!Number.isInteger(port) || port < 1 || port > 65535) return undefined;
  return { host: url.hostname, port, secure };
}

/** The options for sshs3's own AWS calls (sign-in, listing, scanning). */
export function awsNetworkToOptions(net: AwsNetworkSettings | undefined): AwsSsoNetworkOptions {
  const proxy = parseHttpsProxy(net?.httpsProxy);
  return {
    customCaPath: net?.customCaPath?.trim() || undefined,
    rejectUnauthorized: net?.rejectUnauthorized,
    proxy: proxy ? { enabled: true, type: 'http', host: proxy.host, port: proxy.port } : undefined,
  };
}

/** Environment for the `aws` CLI started by ssh: the proxy and CA bundle, never a credential. */
export function awsNetworkEnv(net: AwsNetworkSettings | undefined): Record<string, string> {
  const env: Record<string, string> = {};
  const proxy = parseHttpsProxy(net?.httpsProxy);
  if (proxy) env.HTTPS_PROXY = `${proxy.secure ? 'https' : 'http'}://${proxy.host.includes(':') ? `[${proxy.host}]` : proxy.host}:${proxy.port}`;
  const ca = net?.customCaPath?.trim();
  if (ca && /^([/~]|[A-Za-z]:[\\/])/.test(ca) && ![...ca].some((c) => c === '\n' || c === '\r' || c === '\0')) env.AWS_CA_BUNDLE = ca;
  return env;
}
