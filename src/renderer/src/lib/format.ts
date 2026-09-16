export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  const formatted = exponent === 0 ? String(value) : value.toFixed(value < 10 ? 2 : 1);
  return `${formatted} ${units[exponent]}`;
}

export function formatSpeed(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/s`;
}

export function joinPath(base: string, name: string): string {
  if (!base || base === '/' || base === '') return `/${name}`;
  const sep = base.includes('\\') && !base.includes('/') ? '\\' : '/';
  return base.endsWith(sep) ? `${base}${name}` : `${base}${sep}${name}`;
}

export function parentPath(currentPath: string): string {
  if (!currentPath || currentPath === '/') return '/';
  const sep = currentPath.includes('\\') && !currentPath.includes('/') ? '\\' : '/';
  const trimmed = currentPath.endsWith(sep) ? currentPath.slice(0, -1) : currentPath;
  const idx = trimmed.lastIndexOf(sep);
  if (idx <= 0) return sep;
  return trimmed.slice(0, idx);
}

export function pathSegments(currentPath: string): { label: string; path: string }[] {
  if (!currentPath) return [{ label: '/', path: '/' }];
  const sep = currentPath.includes('\\') && !currentPath.includes('/') ? '\\' : '/';
  const parts = currentPath.split(sep).filter(Boolean);
  const isWindows = sep === '\\';
  const segments: { label: string; path: string }[] = [];

  if (isWindows && parts.length > 0 && /^[a-zA-Z]:$/.test(parts[0])) {
    segments.push({ label: parts[0], path: `${parts[0]}\\` });
    for (let i = 1; i < parts.length; i++) {
      segments.push({ label: parts[i], path: parts.slice(0, i + 1).join(sep) });
    }
    return segments;
  }

  segments.push({ label: '/', path: '/' });
  for (let i = 0; i < parts.length; i++) {
    segments.push({ label: parts[i], path: `/${parts.slice(0, i + 1).join('/')}` });
  }
  return segments;
}

export function classNames(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

export function formatDateTime(date?: Date | string | number): string {
  const d = date ? new Date(date) : new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hours = pad(d.getHours());
  const minutes = pad(d.getMinutes());
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}
