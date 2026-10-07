import { FileSink } from './FileSink';
import { resolveLogLevel, setLogLevel, setLogSinks, type LogLevel, type LogSink } from './Logger';

export { createLogger, getLogLevel, isLogLevel, resolveLogLevel, setLogLevel, type LogLevel, type Logger } from './Logger';
export { FileSink } from './FileSink';

let fileSink: FileSink | null = null;

export interface ConfigureLoggingOptions {
  dir: string;
  settingLevel?: unknown;
  /** Also print to stdout/stderr (development builds). */
  mirrorToConsole?: boolean;
}

/** Call once at startup, before services are created. */
export function configureLogging(options: ConfigureLoggingOptions): LogLevel {
  fileSink = new FileSink({ dir: options.dir });
  const sinks: LogSink[] = [fileSink];
  // eslint-disable-next-line no-console -- the dev mirror is the one place the logger itself prints
  if (options.mirrorToConsole) sinks.push({ write: (line) => console.log(line) });
  setLogSinks(sinks);
  const level = resolveLogLevel(options.settingLevel);
  setLogLevel(level);
  return level;
}

export function getLogDirectory(): string | null {
  return fileSink?.directory ?? null;
}

export function tailLog(maxLines: number): Promise<string[]> {
  return fileSink ? fileSink.tail(maxLines) : Promise.resolve([]);
}

export function flushLogs(): Promise<void> {
  return fileSink ? fileSink.flush() : Promise.resolve();
}
