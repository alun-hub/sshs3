/**
 * Decides whether a failed terminal command is worth offering to re-run with `sudo`.
 *
 * Works from the command text and its (prompt-stripped) output, so it needs no exit code; the
 * exit code from OSC 133 is only used as extra confirmation when the shell provides it.
 */

export interface SudoRetryInput {
  /** The command line as typed, without the prompt. */
  command: string | null;
  /** Output of that command, without the trailing prompt. */
  output: string | null;
  /** Exit code when the shell reports one (OSC 133 `D`). */
  exitCode?: number;
  /** The prompt we are returned to already belongs to root. */
  atRootPrompt: boolean;
}

export interface SudoRetrySuggestion {
  sudoCommand: string;
}

/** Output longer than this is a log or a listing, not a one-line error. */
const MAX_OUTPUT_LINES = 20;

/** `Permission denied (publickey,...)` is an SSH authentication failure, not a local permission problem. */
const SSH_AUTH_DENIED_RE = /Permission denied \(/;

const DENIED_PATTERNS: RegExp[] = [
  /: Permission denied\s*$/i,
  /Operation not permitted/i,
  /\bEACCES\b/,
  /\bAre you root\b/i,
  /\bmust be (?:run as )?root\b/i,
  /\brequires? root\b/i,
  /Could not open lock file/i,
  /Interactive authentication required/i,
];

/** Commands whose permission errors come from a remote or from privilege handling itself. */
const EXCLUDED_COMMANDS = new Set(['sudo', 'doas', 'su', 'ssh', 'scp', 'sftp', 'rsync', 'mosh', 'git']);

function firstWord(command: string): string {
  const word = command.trim().split(/\s+/)[0] ?? '';
  return word.replace(/^.*\//, '');
}

export function outputIndicatesPermissionDenied(output: string): boolean {
  const lines = output.split('\n').filter((l) => l.trim() !== '');
  if (lines.length === 0 || lines.length > MAX_OUTPUT_LINES) return false;
  return lines.some((line) => !SSH_AUTH_DENIED_RE.test(line) && DENIED_PATTERNS.some((re) => re.test(line)));
}

export function buildSudoCommand(command: string): string {
  return `sudo ${command.trim()}`;
}

export function detectSudoRetry(input: SudoRetryInput): SudoRetrySuggestion | null {
  const { command, output, exitCode, atRootPrompt } = input;
  if (atRootPrompt) return null;
  if (exitCode === 0) return null;
  const cmd = command?.trim();
  if (!cmd || !output) return null;
  if (EXCLUDED_COMMANDS.has(firstWord(cmd))) return null;
  // The shell opens a redirect target before sudo runs, so a prefix would not help.
  if (cmd.includes('>')) return null;
  if (!outputIndicatesPermissionDenied(output)) return null;
  return { sudoCommand: buildSudoCommand(cmd) };
}

/** True when the prompt line ends in `#`, i.e. the session is already root. */
export function isRootPromptLine(line: string): boolean {
  return /#\s*$/.test(line.trimEnd());
}
