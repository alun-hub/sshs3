import { app as electronApp, shell as electronShell } from 'electron';
import { IPC_CHANNELS } from '../../shared/types/ipc';
import { createLogger, getLogDirectory, getLogLevel, isLogLevel, tailLog } from '../log';
import type { IpcBridge } from '../IpcBridge';

/** The part of IpcBridge this handler group may use. */
export type LogHost = Pick<IpcBridge, 'registerHandler'>;

const MAX_MESSAGE_LENGTH = 2000;
const MAX_SCOPE_LENGTH = 40;
const MAX_PER_SECOND = 100;
const DIAGNOSTIC_LINES = 200;

const rendererLog = createLogger('renderer');
const writers = new Map<string, ReturnType<typeof createLogger>>();

let windowStart = 0;
let windowCount = 0;

/** A compromised or buggy renderer must not be able to flood the log (and the disk) through this channel. */
function allowWrite(now = Date.now()): boolean {
  if (now - windowStart >= 1000) {
    windowStart = now;
    windowCount = 0;
  }
  return ++windowCount <= MAX_PER_SECOND;
}

export function registerLogHandlers(bridge: LogHost): void {
  bridge.registerHandler(
    IPC_CHANNELS.LOG_WRITE,
    async (_event, level: unknown, scope: unknown, message: unknown, ctx?: unknown): Promise<void> => {
      if (!isLogLevel(level) || typeof scope !== 'string' || typeof message !== 'string') return;
      if (!allowWrite()) return;
      const name = `renderer.${scope.slice(0, MAX_SCOPE_LENGTH)}`;
      let logger = writers.get(name);
      if (!logger) {
        if (writers.size >= 50) logger = rendererLog;
        else {
          logger = createLogger(name);
          writers.set(name, logger);
        }
      }
      logger[level](message.slice(0, MAX_MESSAGE_LENGTH), ctx);
    }
  );

  bridge.registerHandler(IPC_CHANNELS.LOG_OPEN_FOLDER, async (): Promise<void> => {
    // Fixed, main-owned path: the renderer never chooses what gets opened.
    const dir = getLogDirectory();
    if (dir) await electronShell.openPath(dir);
  });

  bridge.registerHandler(IPC_CHANNELS.LOG_GET_DIAGNOSTICS, async (): Promise<string> => {
    const header = [
      `sshs3 ${electronApp.getVersion()} (${electronApp.isPackaged ? 'packaged' : 'dev'})`,
      `Electron ${process.versions.electron}, Node ${process.versions.node}`,
      `${process.platform} ${process.arch}`,
      `log level: ${getLogLevel()}`,
      '',
    ];
    return [...header, ...(await tailLog(DIAGNOSTIC_LINES))].join('\n');
  });
}
