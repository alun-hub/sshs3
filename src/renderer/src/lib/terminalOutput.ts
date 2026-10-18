import type { IMarker, Terminal } from 'xterm';

const MAX_MARKERS = 50;

// Matches typical shell prompts ending in $, #, %, >, ❯, or ➜ followed by whitespace,
// including git branch decorators like `➜ git:(main) ` or `[user@host /dir]# `
// and box-drawing prompt footers like `╰─$ ` or `╰─❯ `
const PROMPT_PREFIX_RE =
  /^(?:[╰└┗].*?[$#%>❯➜]\s*|(?:PS\s+)?[A-Za-z]:\\[^<>|?*"]*?>\s*|(?:(?:\([^)]+\)\s+)?(?:\[[^\]]+\]|[\w.@:~/-]+[@:][^\s$#%>]*)\s*)?[$#%>]\s+|[❯➜]\s*(?:.*?\s*git:\([^)]+\)\s*)?)/;

// Matches an entire line that consists only of a prompt or multi-line prompt header/footer
const FULL_PROMPT_LINE_RE =
  /^(?:[╰└┗].*|(?:PS\s+)?[A-Za-z]:\\[^<>|?*"]*>\s*|[╭┌┏].*|(?:(?:\([^)]+\)\s+)?(?:\[[^\]]+\]|[\w.@:~/-]+[@:][^\s$#%>]*)\s*)?[$#%>❯➜]\s*|[❯➜]\s*(?:.*?\s*git:\([^)]+\)\s*)?|[\w.-]+@[\w.-]+(?:\s+in\s+[^\s]+|:[^\s$#%>]*)\s*(?:\[[^\]]+\])?\s*)$/;

/**
 * Strips shell prompt prefix from a command line if present.
 */
export function stripPrompt(line: string): string {
  return line.replace(PROMPT_PREFIX_RE, '').trim();
}

/**
 * Checks whether a given line consists solely of a shell prompt.
 */
export function isPromptLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return true;
  return FULL_PROMPT_LINE_RE.test(trimmed);
}

/**
 * Strips any trailing prompt line(s) from command output.
 */
export function stripTrailingPrompt(text: string): string {
  const lines = text.split('\n');
  while (lines.length > 0) {
    const last = lines[lines.length - 1].trim();
    if (!last || isPromptLine(last)) {
      lines.pop();
    } else {
      break;
    }
  }
  return lines.join('\n');
}

// eslint-disable-next-line no-control-regex
const ANSI_REGEX = /\x1b\[[0-9;?]*[a-zA-Z]|\x1b\].*?(?:\x07|\x1b\\)/g;

function resolveTildePath(raw: string, userHome: string, promptUser?: string): string {
  let effectiveHome = userHome;
  if (promptUser) {
    if (promptUser === 'root') {
      effectiveHome = '/root';
    } else if (userHome.startsWith('/Users/')) {
      effectiveHome = `/Users/${promptUser}`;
    } else {
      effectiveHome = `/home/${promptUser}`;
    }
  }
  if (raw === '~') return effectiveHome;
  if (raw.startsWith('~/')) return `${effectiveHome.replace(/\/+$/, '')}/${raw.slice(2)}`;
  return raw;
}

/**
 * Extracts current working directory from shell prompt text (e.g. starship, oh-my-zsh, default bash).
 */
export function extractCwdFromPrompt(text: string, userHome = '/home/user'): string | null {
  if (!text) return null;
  const clean = text.replace(ANSI_REGEX, '');
  const lines = clean.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return null;

  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 4); i--) {
    const line = lines[i];

    // 0. Windows shells: PowerShell `PS C:\Users\me\proj> ` and cmd.exe `C:\Users\me\proj>`.
    // Non-greedy up to the first `>` followed by whitespace/end, so a typed command after the
    // prompt (`PS C:\x> cat a.md`) and paths containing spaces both work.
    const windowsMatch = line.match(/^(?:PS\s+)?([A-Za-z]:\\[^<>|?*"]*?)>(?:\s|$)/);
    if (windowsMatch) return windowsMatch[1].length > 3 ? windowsMatch[1].replace(/\\+$/, '') : windowsMatch[1];

    const userMatch = line.match(/(?:^|[\r\n\s╭[(])([a-zA-Z0-9._-]+)@([a-zA-Z0-9.-]+)/);
    const promptUser = userMatch ? userMatch[1] : undefined;

    // 1. Starship / powerlevel10k / multi-line with "in <path>"
    const starshipMatch = line.match(/(?:[╭┌┏].*?|[\w.-]+@[\w.-]+\s+)\bin\s+([~/][^\s[\]]*)/);
    if (starshipMatch) return resolveTildePath(starshipMatch[1], userHome, promptUser);

    // 2. Bracketed prompt: `[user@host /etc]$ ` or `[user@host: ~/dir]# `
    const bracketMatch = line.match(/\[[^\]\s]+[@\s:]\s*([~/][^\]\s]*?)\]/);
    if (bracketMatch) return resolveTildePath(bracketMatch[1], userHome, promptUser);

    // 3. Colon prompt (standard bash/zsh, title bar, git decorated): `user@host:/var/log$ `, `user@host: /var/log`, `user@host:~/repo (main) $ `
    const colonMatch = line.match(/[@:][^:\s]+:\s*([~/][^\s$#%>()]*)(?:\s*(?:\([^)]+\)|git:[^\s]+))?\s*(?:[$#%>❯➜]|$)/);
    if (colonMatch) return resolveTildePath(colonMatch[1], userHome, promptUser);

    // 4. Space-separated prompt: `user@host /var/log % `, `user@host ~/dir> `
    const spaceMatch = line.match(/[\w.-]+@[\w.-]+\s+([~/][^\s$#%>❯➜\])]*)\s*[$#%>❯➜]/);
    if (spaceMatch) return resolveTildePath(spaceMatch[1], userHome, promptUser);

    // 5. Minimal prompt with just path and terminator: `/var/log # `, `~/repo $ `
    const minimalMatch = line.match(/^([~/][^\s$#%>❯➜]*)\s*[$#%>❯➜]\s*$/);
    if (minimalMatch) return resolveTildePath(minimalMatch[1], userHome, promptUser);
  }
  return null;
}

export interface CleanOutputInfo {
  text: string;
  lineCount: number;
  charCount: number;
}

interface OscRegion {
  start: IMarker;
  end?: IMarker;
  commandMarker?: IMarker;
  exitCode?: number;
  /** The cursor was past column 0 when the output ended, i.e. the last output line has no newline yet. */
  partialLastLine?: boolean;
}

/**
 * Finds the output of the last command.
 *
 * Exact when the shell emits OSC 133 prompt marks (fish, and zsh/bash with shell integration):
 * output runs from the `C` mark to the next `A`/`D` mark. Otherwise a heuristic is used: every Enter
 * typed in the normal screen buffer drops a marker on the command line, so a command's output is
 * whatever sits between its marker and the next one (or the current prompt line). With a multi-line
 * prompt that heuristic also picks up the first prompt line(s).
 */
export class CommandOutputTracker {
  private markers: IMarker[] = [];
  private regions: OscRegion[] = [];
  private pendingCommandMarker?: IMarker;
  private readonly oscHandler: { dispose(): void };

  constructor(private readonly term: Terminal) {
    this.oscHandler = term.parser.registerOscHandler(133, (data) => {
      const kind = data.charAt(0);
      if (kind === 'B') {
        const marker = term.registerMarker(0);
        if (marker) this.pendingCommandMarker = marker;
      } else if (kind === 'C') {
        const start = term.registerMarker(0);
        if (start) {
          const region: OscRegion = { start };
          if (this.pendingCommandMarker) {
            region.commandMarker = this.pendingCommandMarker;
            this.pendingCommandMarker = undefined;
          }
          this.regions.push(region);
          if (this.regions.length > MAX_MARKERS) {
            const evicted = this.regions.shift();
            evicted?.start.dispose();
            evicted?.commandMarker?.dispose();
            evicted?.end?.dispose();
          }
        }
      } else if (kind === 'A' || kind === 'D') {
        const open = this.regions[this.regions.length - 1];
        if (open && !open.end) {
          open.end = term.registerMarker(0);
          open.partialLastLine = term.buffer.active.cursorX > 0;
          if (kind === 'D' && data.length > 1) {
            const rawCode = data.slice(1).replace(/^;/, '');
            const parsed = parseInt(rawCode, 10);
            if (!Number.isNaN(parsed)) open.exitCode = parsed;
          }
        }
      }
      return true;
    });
  }

  /** Call when the user presses Enter (the cursor is still on the command line). */
  public recordEnter(): void {
    if (this.term.buffer.active.type !== 'normal') return;
    const marker = this.term.registerMarker(0);
    if (!marker) return;
    this.markers.push(marker);
    if (this.markers.length > MAX_MARKERS) this.markers.shift()?.dispose();
  }

  /** Text of the most recent command that produced output, or null when there is none. */
  public lastOutput(): string | null {
    const buf = this.term.buffer.active;
    if (buf.type !== 'normal') return null;
    const cursorLine = buf.baseY + buf.cursorY;
    if (this.regions.length > 0) {
      const osc = this.lastOscOutput();
      return osc ? stripTrailingPrompt(osc) : null;
    }
    const live = this.markers.filter((m) => !m.isDisposed && m.line >= 0);
    for (let i = live.length - 1; i >= 0; i--) {
      const end = i + 1 < live.length ? live[i + 1].line : cursorLine;
      const text = this.readLines(live[i].line + 1, end);
      if (text.trim()) return stripTrailingPrompt(text);
    }
    return null;
  }

  private lastOscOutput(): string | null {
    for (let i = this.regions.length - 1; i >= 0; i--) {
      const { start, end, commandMarker, partialLastLine } = this.regions[i];
      if (start.isDisposed || start.line < 0 || !end || end.isDisposed || end.line < 0) continue;
      const fromLine =
        commandMarker && !commandMarker.isDisposed && start.line === commandMarker.line
          ? start.line + 1
          : start.line;
      const text = this.readLines(fromLine, end.line + (partialLastLine ? 1 : 0));
      if (text.trim()) return text;
    }
    return null;
  }

  /** Lines [from, to) joined back into logical lines, without trailing blanks. */
  private readLines(from: number, to: number): string {
    const buf = this.term.buffer.active;
    const lines: string[] = [];
    for (let i = from; i < to; i++) {
      const line = buf.getLine(i);
      if (!line) continue;
      const text = line.translateToString(true);
      if (line.isWrapped && lines.length > 0) lines[lines.length - 1] += text;
      else lines.push(text);
    }
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
    return lines.join('\n');
  }

  /**
   * Text of the command that produced the last output, or null if unknown.
   */
  public lastCommand(): string | null {
    const buf = this.term.buffer.active;
    if (buf.type !== 'normal') return null;

    if (this.regions.length > 0) {
      for (let i = this.regions.length - 1; i >= 0; i--) {
        const { commandMarker, start } = this.regions[i];
        if (commandMarker && !commandMarker.isDisposed && commandMarker.line >= 0) {
          const toLine =
            start && !start.isDisposed && start.line >= commandMarker.line
              ? start.line + 1
              : commandMarker.line + 1;
          const text = this.readLines(commandMarker.line, toLine).trim();
          if (text) return stripPrompt(text);
        }
      }
    }

    const live = this.markers.filter((m) => !m.isDisposed && m.line >= 0);
    for (let i = live.length - 1; i >= 0; i--) {
      const line = buf.getLine(live[i].line);
      if (line) {
        const text = line.translateToString(true).trim();
        if (text) return stripPrompt(text);
      }
    }
    return null;
  }

  /** Details of the most recent command output, or null when there is none. */
  public getCleanOutput(): CleanOutputInfo | null {
    const text = this.lastOutput();
    if (!text || !text.trim()) return null;
    const lines = text.split('\n');
    return {
      text,
      lineCount: lines.length,
      charCount: text.length,
    };
  }

  public dispose(): void {
    this.oscHandler.dispose();
    this.pendingCommandMarker?.dispose();
    this.pendingCommandMarker = undefined;
    for (const m of this.markers) m.dispose();
    for (const r of this.regions) {
      r.start.dispose();
      r.commandMarker?.dispose();
      r.end?.dispose();
    }
    this.markers = [];
    this.regions = [];
  }
}

/**
 * Copies the clean output of the most recent command to the system clipboard.
 * Returns information about the copied text, or null if no output exists.
 */
export async function copyCleanOutputToClipboard(
  tracker: CommandOutputTracker
): Promise<CleanOutputInfo | null> {
  const info = tracker.getCleanOutput();
  if (!info) return null;
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(info.text);
      return info;
    }
  } catch {
    // Clipboard permission denied or document not focused
  }
  return null;
}
