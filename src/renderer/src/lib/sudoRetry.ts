/**
 * Decides whether a failed terminal command is worth offering to re-run with `sudo`.
 *
 * Works from the command text and its (prompt-stripped) output, so it needs no exit code; the
 * exit code from OSC 133 is only used as extra confirmation when the shell provides it.
 */

export interface SudoRetryInput {
  /** The command line as typed, without the prompt. */
  command: string | null;
  /** Output of that same command, without the trailing prompt. */
  output: string | null;
  /** Exit code when the shell reports one (OSC 133 `D`). */
  exitCode?: number;
  /** The session is already root. */
  atRootPrompt: boolean;
}

export interface SudoRetrySuggestion {
  sudoCommand: string;
}

/** Output longer than this is a log or a listing, not a one-line error. */
const MAX_OUTPUT_LINES = 20;
/** The error must be near the end of the output; a program that merely mentions it earlier is not failing. */
const ERROR_TAIL_LINES = 3;

/** `Permission denied (publickey,...)` is an SSH authentication failure, not a local permission problem. */
const SSH_AUTH_DENIED_RE = /Permission denied \(/;

// eslint-disable-next-line no-control-regex
const UNSAFE_COMMAND_CHARS_RE = /[\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/;

/**
 * `Operation not permitted` also comes from firewalls and sandboxes (`ping: sendto: ...`), where sudo
 * does not help, so it only counts next to a path or a quoted name.
 */
const DENIED_PATTERNS: RegExp[] = [
  /: Permission denied\s*$/i,
  /(?:\/|['‘’"][^'‘’"]+['‘’"]).*Operation not permitted/i,
  /\bAre you root\b/i,
  /\bmust be (?:run as )?root\b/i,
  /\brequires? root\b/i,
  /Could not open lock file/i,
  /Interactive authentication required/i,
];

/** `sudo` cannot run these: they are shell builtins, or they act on the shell's own state. */
const SHELL_BUILTINS = new Set([
  'cd', 'source', '.', 'export', 'alias', 'unalias', 'set', 'unset', 'ulimit', 'umask', 'exec', 'eval',
  'builtin', 'command', 'type', 'hash', 'read', 'history', 'exit', 'logout', 'fg', 'bg', 'jobs', 'pushd',
  'popd', 'dirs', 'local', 'declare', 'typeset', 'readonly', 'shopt', 'trap', 'wait', 'let', 'test', '[',
]);

/** Privilege handling and remote tools: their permission errors are not fixed by a local `sudo`. */
const PRIVILEGE_AND_REMOTE = ['sudo', 'doas', 'su', 'ssh', 'scp', 'sftp', 'rsync', 'mosh', 'git'];

/** Package tools that would leave root-owned files in the user's home when run through `sudo`. */
const USER_SCOPED_TOOLS = ['npm', 'npx', 'yarn', 'pnpm', 'pip', 'pip3', 'cargo', 'gem', 'bundle', 'composer', 'brew'];

const EXCLUDED_COMMANDS = new Set([...SHELL_BUILTINS, ...PRIVILEGE_AND_REMOTE, ...USER_SCOPED_TOOLS]);

/** Redirects that do not open a file for writing or reading, so `sudo` is unaffected by them. */
const HARMLESS_REDIRECTS_RE = /(?:\d*|&)>>?\s*\/dev\/(?:null|stderr|stdout)\b|\d*>&\d+|&>>?\s*\/dev\/null\b/g;

/** Commands that only run another command (`time npm i`), so the real command is the next word. */
const WRAPPER_COMMANDS = new Set(['env', 'time', 'nohup', 'nice', 'ionice', 'stdbuf', 'command']);
/** `NAME=value` in front of a command. `sudo` refuses most of these (env_reset), so no offer is made. */
const ENV_ASSIGNMENT_RE = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** The name of the command that actually runs, looking through `time`, `nohup` and the like. */
function commandName(command: string): string {
  const words = command.trim().split(/\s+/);
  let i = 0;
  while (i < words.length - 1 && WRAPPER_COMMANDS.has(words[i].replace(/^.*\//, ''))) {
    i++;
    // Options and their numbers (`nice -n 5`, `env -i FOO=1`) are skipped up to the next plain word.
    while (
      i < words.length - 1 &&
      (words[i].startsWith('-') || /^\d+$/.test(words[i]) || ENV_ASSIGNMENT_RE.test(words[i]))
    ) {
      i++;
    }
  }
  return (words[i] ?? '').replace(/^.*\//, '');
}

export function outputIndicatesPermissionDenied(output: string): boolean {
  const lines = output.split('\n').filter((l) => l.trim() !== '');
  if (lines.length === 0 || lines.length > MAX_OUTPUT_LINES) return false;
  return lines
    .slice(-ERROR_TAIL_LINES)
    .some((line) => !SSH_AUTH_DENIED_RE.test(line) && DENIED_PATTERNS.some((re) => re.test(line)));
}

/** True when `sudo <command>` would only elevate part of the line, or not the part that failed. */
function isCompoundOrRedirected(command: string): boolean {
  if (/;|&&|\|\|/.test(command)) return true;
  // The shell opens redirect targets before sudo runs, so a prefix would not help.
  return /[<>]/.test(command.replace(HARMLESS_REDIRECTS_RE, ''));
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
  // The command is read back from the screen, which remote output can influence. Anything that is not
  // a single line of plain printable text (newlines, control or escape characters, bidi overrides and
  // zero-width characters that make the shown text differ from what runs) is never offered.
  if (UNSAFE_COMMAND_CHARS_RE.test(cmd)) return null;
  if (ENV_ASSIGNMENT_RE.test(cmd)) return null;
  const name = commandName(cmd);
  if (ENV_ASSIGNMENT_RE.test(name) || EXCLUDED_COMMANDS.has(name)) return null;
  if (isCompoundOrRedirected(cmd)) return null;
  if (!outputIndicatesPermissionDenied(output)) return null;
  return { sudoCommand: buildSudoCommand(cmd) };
}

/** True when the prompt shows root: a trailing `#`, or `root@host`. */
export function isRootPromptLine(line: string): boolean {
  return /#\s*$/.test(line.trimEnd()) || /(?:^|[\s[(])root@[\w.-]+/.test(line);
}
