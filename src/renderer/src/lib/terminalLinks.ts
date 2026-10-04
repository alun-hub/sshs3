import type { IDisposable, ILink, Terminal } from 'xterm';

const URL_RE = /https?:\/\/[^\s<>"'`]+/g;
const TRAILING_PUNCT_RE = /[.,;:!?)\]}>]+$/;
// Absolute (`/var/log/x`) or home-relative (`~/x`) paths, optionally followed by `:line[:col]`.
// The lookbehind keeps us out of URLs (`https://host/x`), words (`and/or`) and dates (`1/2`).
const PATH_RE = /(?<![\w:/.~-])(~?\/[\w.@%+~-]+(?:\/[\w.@%+~-]*)*)(?::\d+(?::\d+)?)?/g;

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

export function findPaths(text: string): TextMatch[] {
  const out: TextMatch[] = [];
  for (const m of text.matchAll(PATH_RE)) {
    const path = m[1].replace(/[.,;]+$/, '');
    if (path.length < 2 || !/[A-Za-z]/.test(path)) continue;
    const suffix = m[0].length - m[1].length;
    out.push({ index: m.index ?? 0, text: path, length: path.length + (path.length === m[1].length ? suffix : 0) });
  }
  return out;
}

export interface TerminalLinkHandlers {
  openUrl: (url: string) => void;
  /** Provide to make absolute / `~/` file paths Ctrl+clickable. */
  openPath?: (path: string) => void;
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

      const matches: (TextMatch & { open: (text: string) => void })[] = findUrls(text).map(({ index, url }) => ({
        index,
        text: url,
        length: url.length,
        open: handlers.openUrl,
      }));
      if (handlers.openPath) {
        for (const p of findPaths(text)) {
          const insideUrl = matches.some((u) => p.index >= u.index && p.index < u.index + u.length);
          if (!insideUrl) matches.push({ ...p, open: handlers.openPath });
        }
      }

      const links: ILink[] = [];
      for (const { index, text: linkText, length, open } of matches) {
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
        });
      }
      callback(links.length > 0 ? links : undefined);
    },
  });
}
