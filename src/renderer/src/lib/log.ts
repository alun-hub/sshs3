import type { LogLevel } from '@shared/types/log';

/**
 * Renderer-side logging. Lines are forwarded to the main process, which masks,
 * rate-limits and writes them to the same log file as everything else. Never
 * pass PINs, passwords or key material here (main masks known patterns, but
 * the first line of defence is not sending them).
 */
function send(level: LogLevel, scope: string, message: string, ctx?: unknown): void {
  const detail = ctx instanceof Error ? { name: ctx.name, message: ctx.message } : ctx;
  void window.multissh?.writeLog?.(level, scope, message, detail)?.catch(() => {});
}

export function createRendererLogger(scope: string) {
  return {
    error: (message: string, ctx?: unknown) => send('error', scope, message, ctx),
    warn: (message: string, ctx?: unknown) => send('warn', scope, message, ctx),
    info: (message: string, ctx?: unknown) => send('info', scope, message, ctx),
    debug: (message: string, ctx?: unknown) => send('debug', scope, message, ctx),
  };
}

let installed = false;

/** Forwards uncaught errors and unhandled rejections in the renderer to the log. */
export function installGlobalErrorLogging(): void {
  if (installed) return;
  installed = true;
  const log = createRendererLogger('global');
  window.addEventListener('error', (e) => log.error('uncaught error', { message: e.message, source: e.filename, line: e.lineno }));
  window.addEventListener('unhandledrejection', (e) => log.error('unhandled rejection', e.reason));
}
