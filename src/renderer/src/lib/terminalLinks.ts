import type { IDisposable, ILink, Terminal } from 'xterm';

const URL_RE = /https?:\/\/[^\s<>"'`]+/g;
const TRAILING_PUNCT_RE = /[.,;:!?)\]}>]+$/;
// Quoted paths: single or double quoted paths containing spaces/characters
const QUOTED_PATH_RE =
  /(?<![\w:/.~-])(['"])([^'"\r\n\t]+)\1(?::\d+(?::\d+)?)?/g;

// Slashed paths: absolute (`/var/log/x`), home-relative (`~/x`), explicit relative (`./x`, `../x`),
// or subpaths (`src/file.ts`, `dir/`), optionally with backslash-escaped spaces, optionally followed by `:line[:col]`.
const SLASH_PATH_RE =
  /(?<![\w:/.~-])((?:~?\/|\.\.?\/|(?:[\w.@+-]|\\ )+\/)(?:(?:[\w.@%+~-]|\\ )+\/)*(?:(?:[\w.@%+~-]|\\ )+)?)(?::\d+(?::\d+)?)?/g;

// Standalone filenames with extensions (e.g. `index.html`, `test.txt`, `windows.png`, `.bashrc`),
// or well-known filenames (e.g. `Dockerfile`, `Makefile`), optionally with backslash-escaped spaces, optionally followed by `:line[:col]`.
const STANDALONE_FILE_RE =
  /(?<![\w:/.~-])(?:\b((?:[A-Za-z0-9_~-]|\\ )+\.[A-Za-z0-9_.-]+)|(\.[A-Za-z0-9_~-]+)|(Dockerfile|Makefile|Containerfile|Vagrantfile|Procfile|Gemfile|Rakefile|LICENSE|README))(?::\d+(?::\d+)?)?(?![\w:/.~-])/g;

const KNOWN_FILENAMES = new Set([
  'Dockerfile',
  'Makefile',
  'Containerfile',
  'Vagrantfile',
  'Procfile',
  'Gemfile',
  'Rakefile',
  'LICENSE',
  'README',
]);

export interface TextMatch {
  index: number;
  /** The clickable text (URL, or path without a `:line` suffix). */
  text: string;
  /** Length of the highlighted range, including any `:line:col` suffix. */
  length: number;
}

export function findUrls(text: string): { index: number; url: string }[] {
  const out: { index: number; url: string }[] = [];
  for (const m of text.matchAll(URL_RE)) {
    let url = m[0];
    // Keep a closing paren only when the URL has a matching opening one (e.g. wikipedia links)
    while (TRAILING_PUNCT_RE.test(url)) {
      const last = url[url.length - 1];
      if (last === ')' && (url.match(/\(/g)?.length ?? 0) >= (url.match(/\)/g)?.length ?? 0)) break;
      url = url.slice(0, -1);
    }
    if (/^https?:\/\/[^/?#]+/.test(url)) out.push({ index: m.index ?? 0, url });
  }
  return out;
}

function isValidSlashedPath(raw: string): boolean {
  if (raw.length < 2 || !/[A-Za-z]/.test(raw)) return false;
  if (raw.startsWith('/') || raw.startsWith('~/') || raw.startsWith('./') || raw.startsWith('../')) {
    return true;
  }
  if (raw.endsWith('/')) return true;
  const parts = raw.split('/');
  if (parts.length > 2) return true;
  // Two parts (e.g. `src/foo.ts` vs `and/or`): require an extension with letters in the last part
  const last = parts[parts.length - 1];
  const dot = last.lastIndexOf('.');
  return dot > 0 && /[A-Za-z]/.test(last.slice(dot + 1));
}

function isValidStandaloneFile(raw: string): boolean {
  if (KNOWN_FILENAMES.has(raw)) return true;
  if (raw.startsWith('.')) {
    return raw.length >= 2 && /[A-Za-z]/.test(raw);
  }
  // Reject IP addresses (1.1.1.1) and version numbers (0.96.7, v1.2.3)
  if (/^\d+\.\d+\.\d+\.\d+$/.test(raw)) return false;
  if (/^v?\d+(\.\d+)+$/.test(raw)) return false;
  const dot = raw.lastIndexOf('.');
  if (dot <= 0) return false;
  const ext = raw.slice(dot + 1);
  return ext.length >= 1 && ext.length <= 10 && /^[A-Za-z0-9_-]+$/.test(ext) && /[A-Za-z]/.test(ext);
}

export function findPaths(text: string): TextMatch[] {
  const candidates: TextMatch[] = [];

  for (const m of text.matchAll(QUOTED_PATH_RE)) {
    const rawContent = (m[2] || '').trim();
    const unescaped = rawContent.replace(/\\ /g, ' ');
    if (isValidSlashedPath(unescaped) || isValidStandaloneFile(unescaped)) {
      candidates.push({
        index: m.index ?? 0,
        text: unescaped,
        length: m[0].length,
      });
    }
  }

  for (const m of text.matchAll(SLASH_PATH_RE)) {
    const rawMatch = m[1].replace(/[.,;]+$/, '');
    const unescaped = rawMatch.replace(/\\ /g, ' ');
    if (!isValidSlashedPath(unescaped)) continue;
    const suffix = m[0].length - m[1].length;
    candidates.push({
      index: m.index ?? 0,
      text: unescaped,
      length: rawMatch.length + (rawMatch.length === m[1].length ? suffix : 0),
    });
  }

  for (const m of text.matchAll(STANDALONE_FILE_RE)) {
    const matchedToken = m[1] || m[2] || m[3];
    if (!matchedToken) continue;
    const rawMatch = matchedToken.replace(/[.,;]+$/, '');
    const unescaped = rawMatch.replace(/\\ /g, ' ');
    if (!isValidStandaloneFile(unescaped)) continue;
    const suffix = m[0].length - matchedToken.length;
    candidates.push({
      index: m.index ?? 0,
      text: unescaped,
      length: rawMatch.length + (rawMatch.length === matchedToken.length ? suffix : 0),
    });
  }

  candidates.sort((a, b) => a.index - b.index || b.length - a.length);

  const out: TextMatch[] = [];
  let lastEnd = -1;
  for (const c of candidates) {
    if (c.index >= lastEnd) {
      out.push(c);
      lastEnd = c.index + c.length;
    }
  }
  return out;
}

export interface TerminalLinkHandlers {
  openUrl: (url: string) => void;
  /** Provide to make absolute / `~/` file paths Ctrl+clickable. */
  openPath?: (path: string) => void;
  /** Optional hover callback when mouse enters a file path link. */
  hoverPath?: (event: MouseEvent, path: string) => void;
  /** Optional leave callback when mouse leaves a file path link. */
  leavePath?: (event: MouseEvent, path: string) => void;
}

/**
 * Makes plain-text http(s) URLs (and, when `openPath` is given, file paths) in the terminal
 * react to Ctrl+click (Cmd+click on macOS).
 */
export function registerTerminalLinks(term: Terminal, handlers: TerminalLinkHandlers): IDisposable {
  return term.registerLinkProvider({
    provideLinks(bufferLineNumber, callback) {
      const buf = term.buffer.active;
      let first = bufferLineNumber - 1;
      while (first > 0 && buf.getLine(first)?.isWrapped) first--;
      // Text of the whole wrapped line plus, per character, the terminal cell it sits in.
      // Wide characters (CJK, emoji) take two cells, so string index != cell index.
      let text = '';
      const cellOf: number[] = [];
      let last = first;
      for (let i = first; ; i++) {
        const line = buf.getLine(i);
        if (!line || (i > first && !line.isWrapped)) break;
        for (let x = 0; x < term.cols; x++) {
          const cell = line.getCell(x);
          if (cell && cell.getWidth() === 0) continue;
          const chars = cell?.getChars() || ' ';
          for (let k = 0; k < chars.length; k++) cellOf.push((i - first) * term.cols + x);
          text += chars;
        }
        last = i;
      }

      const matches: (TextMatch & { open: (text: string) => void; isPath?: boolean })[] = findUrls(text).map(({ index, url }) => ({
        index,
        text: url,
        length: url.length,
        open: handlers.openUrl,
      }));
      if (handlers.openPath || handlers.hoverPath) {
        for (const p of findPaths(text)) {
          const insideUrl = matches.some((u) => p.index >= u.index && p.index < u.index + u.length);
          if (!insideUrl) {
            matches.push({
              ...p,
              open: handlers.openPath ?? (() => {}),
              isPath: true,
            });
          }
        }
      }

      const links: ILink[] = [];
      for (const { index, text: linkText, length, open, isPath } of matches) {
        const startCell = cellOf[index];
        const endCell = cellOf[Math.min(index + length - 1, cellOf.length - 1)];
        if (startCell === undefined || endCell === undefined) continue;
        const startRow = first + Math.floor(startCell / term.cols);
        const endRow = first + Math.floor(endCell / term.cols);
        if (bufferLineNumber - 1 < startRow || bufferLineNumber - 1 > endRow || endRow > last) continue;
        links.push({
          range: {
            start: { x: (startCell % term.cols) + 1, y: startRow + 1 },
            end: { x: (endCell % term.cols) + 1, y: endRow + 1 },
          },
          text: linkText,
          activate: (event, activated) => {
            if (event.ctrlKey || event.metaKey) open(activated);
          },
          hover: (event, activated) => {
            if (isPath && handlers.hoverPath) {
              handlers.hoverPath(event, activated);
            }
          },
          leave: (event, activated) => {
            if (isPath && handlers.leavePath) {
              handlers.leavePath(event, activated);
            }
          },
        });
      }
      callback(links.length > 0 ? links : undefined);
    },
  });
}
