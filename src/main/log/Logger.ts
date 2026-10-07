
import { LOG_LEVELS, type LogLevel } from '../../shared/types/log';
import { redactString, redactValue } from './redact';

export { LOG_LEVELS, type LogLevel };

const RANK: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 };

export interface LogSink {
  write(line: string): void;
}

export interface Logger {
  error(message: string, ctx?: unknown): void;
  warn(message: string, ctx?: unknown): void;
  info(message: string, ctx?: unknown): void;
  debug(message: string, ctx?: unknown): void;
}

let currentLevel: LogLevel = 'info';
let sinks: LogSink[] = [];

export function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === 'string' && (LOG_LEVELS as readonly string[]).includes(value);
}

/** SSHS3_LOG_LEVEL wins over the saved setting so a problem can be captured without opening Settings. */
export function resolveLogLevel(settingLevel: unknown, env: NodeJS.ProcessEnv = process.env): LogLevel {
  const fromEnv = env.SSHS3_LOG_LEVEL?.toLowerCase();
  if (isLogLevel(fromEnv)) return fromEnv;
  return isLogLevel(settingLevel) ? settingLevel : 'info';
}

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

export function getLogLevel(): LogLevel {
  return currentLevel;
}

export function setLogSinks(next: LogSink[]): void {
  sinks = next;
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

/** yyyy-mm-dd HH:mm:ss.SSS (24h, local time) */
export function formatLogTimestamp(d: Date): string {
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
  );
}

/** Scope names are interpolated into the line, so keep them to a safe charset. */
function safeScope(scope: string): string {
  return scope.replace(/[^a-zA-Z0-9:_.-]/g, '_').slice(0, 40) || 'app';
}

export function formatLine(level: LogLevel, scope: string, message: string, ctx: unknown, now = new Date()): string {
  // One record per line: collapse newlines so injected text cannot forge extra entries.
  const msg = redactString(message).replace(/[\r\n]+/g, ' ⏎ ');
  let line = `${formatLogTimestamp(now)} ${level.toUpperCase().padEnd(5)} [${safeScope(scope)}] ${msg}`;
  if (ctx !== undefined) {
    try {
      const json = JSON.stringify(redactValue(ctx));
      if (json !== undefined) line += ` ${json}`;
    } catch {
      line += ' [unserialisable context dropped]';
    }
  }
  return line;
}

export function writeLog(level: LogLevel, scope: string, message: string, ctx?: unknown): void {
  if (RANK[level] > RANK[currentLevel]) return;
  const line = formatLine(level, scope, message, ctx);
  for (const sink of sinks) {
    try {
      sink.write(line);
    } catch {
      // Logging must never take the app down.
    }
  }
}

export function createLogger(scope: string): Logger {
  return {
    error: (message, ctx) => writeLog('error', scope, message, ctx),
    warn: (message, ctx) => writeLog('warn', scope, message, ctx),
    info: (message, ctx) => writeLog('info', scope, message, ctx),
    debug: (message, ctx) => writeLog('debug', scope, message, ctx),
  };
}
