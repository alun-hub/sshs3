/**
 * Pure helper functions for terminal file path detection, classification,
 * and preview metadata formatting.
 */

export type FileTypeCategory =
  | 'image'
  | 'code'
  | 'config'
  | 'markdown'
  | 'archive'
  | 'document'
  | 'directory'
  | 'unknown';

const EXTENSION_CATEGORIES: Record<string, FileTypeCategory> = {
  // Images
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  svg: 'image',
  gif: 'image',
  webp: 'image',
  ico: 'image',
  bmp: 'image',

  // Code
  ts: 'code',
  tsx: 'code',
  js: 'code',
  jsx: 'code',
  mjs: 'code',
  cjs: 'code',
  py: 'code',
  rs: 'code',
  go: 'code',
  c: 'code',
  cpp: 'code',
  h: 'code',
  hpp: 'code',
  java: 'code',
  kt: 'code',
  sh: 'code',
  bash: 'code',
  zsh: 'code',
  fish: 'code',
  rb: 'code',
  php: 'code',
  lua: 'code',
  sql: 'code',
  html: 'code',
  css: 'code',
  scss: 'code',

  // Config & Data
  json: 'config',
  json5: 'config',
  yaml: 'config',
  yml: 'config',
  toml: 'config',
  ini: 'config',
  conf: 'config',
  cfg: 'config',
  env: 'config',
  xml: 'config',
  plist: 'config',
  properties: 'config',
  dockerfile: 'config',

  // Markdown
  md: 'markdown',
  markdown: 'markdown',
  mdx: 'markdown',

  // Archives
  tar: 'archive',
  gz: 'archive',
  tgz: 'archive',
  zip: 'archive',
  bz2: 'archive',
  xz: 'archive',
  '7z': 'archive',

  // Documents & Logs
  txt: 'document',
  log: 'document',
  csv: 'document',
  tsv: 'document',
  pdf: 'document',
};

const EXTENSION_LABELS: Record<string, string> = {
  png: 'PNG Image',
  jpg: 'JPEG Image',
  jpeg: 'JPEG Image',
  svg: 'SVG Vector',
  webp: 'WebP Image',
  gif: 'GIF Animation',
  ts: 'TypeScript',
  tsx: 'React TypeScript',
  js: 'JavaScript',
  jsx: 'React JavaScript',
  py: 'Python',
  rs: 'Rust',
  go: 'Go',
  sh: 'Shell Script',
  bash: 'Bash Script',
  json: 'JSON',
  yaml: 'YAML',
  yml: 'YAML',
  toml: 'TOML',
  conf: 'Configuration',
  env: 'Environment Config',
  dockerfile: 'Dockerfile',
  md: 'Markdown',
  sql: 'SQL',
  log: 'Log File',
  pdf: 'PDF Document',
};

/**
 * Extracts lowercase file extension from a path without leading dot.
 */
export function getFileExtension(filePath: string): string {
  const clean = filePath.split(/[?#]/)[0];
  const lastSegment = clean.split(/[\\/]/).pop() || '';
  if (lastSegment.toLowerCase() === 'dockerfile') return 'dockerfile';
  if (lastSegment.startsWith('.') && !lastSegment.slice(1).includes('.')) {
    // e.g. .env, .gitignore, .bashrc
    return lastSegment.slice(1).toLowerCase();
  }
  const dotIndex = lastSegment.lastIndexOf('.');
  if (dotIndex <= 0) return '';
  return lastSegment.slice(dotIndex + 1).toLowerCase();
}

/**
 * Classifies a file path into a category (code, image, config, directory, etc.)
 */
export function detectFileType(filePath: string): FileTypeCategory {
  if (filePath.endsWith('/') || filePath.endsWith('\\')) return 'directory';
  const ext = getFileExtension(filePath);
  return EXTENSION_CATEGORIES[ext] ?? 'unknown';
}

/**
 * Returns a human-friendly label for the file type (e.g. "TypeScript", "YAML").
 */
export function getLanguageLabel(filePath: string): string {
  if (filePath.endsWith('/') || filePath.endsWith('\\')) return 'Directory';
  const ext = getFileExtension(filePath);
  if (EXTENSION_LABELS[ext]) return EXTENSION_LABELS[ext];
  if (ext) return ext.toUpperCase();
  return 'File';
}

export interface PathDetails {
  raw: string;
  basename: string;
  parentDir: string;
  fullPath: string;
  isDir: boolean;
  extension: string;
  category: FileTypeCategory;
  label: string;
}

/**
 * Parses path details, resolving ~ to userHome and relative paths to currentCwd || userHome,
 * computing basename and parentDir.
 */
export function resolvePathDetails(
  rawPath: string,
  userHome = '/home/user',
  currentCwd?: string
): PathDetails {
  const isDir = rawPath.endsWith('/') || rawPath.endsWith('\\');
  const normalized = rawPath.replace(/[\\/]+$/, '');

  let fullPath: string;
  if (normalized === '~') {
    fullPath = userHome;
  } else if (normalized.startsWith('~/')) {
    fullPath = `${userHome.replace(/\/+$/, '')}/${normalized.slice(2)}`;
  } else if (normalized.startsWith('/') || /^[A-Za-z]:[\\/]/.test(normalized)) {
    fullPath = normalized;
  } else {
    const base = (currentCwd || userHome).replace(/\/+$/, '');
    const rel = normalized.replace(/^\.\//, '');
    fullPath = `${base}/${rel}`;
  }

  const lastSlash = fullPath.lastIndexOf('/');
  const basename = lastSlash >= 0 ? fullPath.slice(lastSlash + 1) : fullPath;
  const parentDir = lastSlash > 0 ? fullPath.slice(0, lastSlash) : '/';

  const category = isDir ? 'directory' : detectFileType(fullPath);
  const label = isDir ? 'Directory' : getLanguageLabel(fullPath);
  const extension = isDir ? '' : getFileExtension(fullPath);

  return {
    raw: rawPath,
    basename: basename || '/',
    parentDir,
    fullPath: isDir ? `${fullPath}/` : fullPath,
    isDir,
    extension,
    category,
    label,
  };
}

/**
 * Truncates multi-line text to a preview snippet of maximum lines and line width.
 */
export function truncateSnippet(text: string, maxLines = 15, maxCharsPerLine = 120): string {
  if (!text) return '';
  const lines = text.split('\n').slice(0, maxLines);
  const truncated = lines.map((line) =>
    line.length > maxCharsPerLine ? `${line.slice(0, maxCharsPerLine)}…` : line
  );
  return truncated.join('\n');
}
