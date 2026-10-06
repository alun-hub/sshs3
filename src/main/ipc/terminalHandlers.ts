import { XServerManager } from '../x11/XServerManager';
import { IPC_CHANNELS } from '../../shared/types/ipc';
import type { SSHConnectionConfig, PtyOptions } from '../../shared/types/ssh';
import type { IpcBridge } from '../IpcBridge';

export function registerTerminalHandlers(bridge: IpcBridge): void {
  bridge.registerHandler(
    IPC_CHANNELS.TERMINAL_CREATE,
    async (
      _event,
      options: { config?: SSHConnectionConfig; local?: boolean; ptyOptions?: PtyOptions }
    ) => {
      if (!options || (!options.config && !options.local)) {
        throw new Error('Connection config is required to create terminal');
      }

      if (bridge.startupUnlockPromise) {
        try {
          await bridge.startupUnlockPromise;
        } catch {
          // Ignore error; terminal session proceeds and prompts if needed
        }
      }

      let config = options.config;
      if (!options.local && config) {
        config = await bridge.restoreSavedSecrets(config);
        config = await bridge.resolveProxyJumpConfig(config);
        config = await bridge.prepareSmartcardConfig(config);
        config = await bridge.prepareFido2Config(config);

        if (config.x11Forwarding && process.platform === 'win32') {
          try {
            const settings = await bridge.settingsStore.getSettings();
            if (settings.x11ServerMode !== 'manual') {
              await XServerManager.ensureRunning({
                customPath: settings.x11ServerPath,
                customArgs: settings.x11ServerArgs,
                display: config.x11Display,
              });
            }
          } catch {
            // Ignore failure to launch X server; SSH will still connect
          }
        }
      }

      let ptyOptions = options.ptyOptions;
      if (options.local) {
        const settings = await bridge.settingsStore.getSettings().catch(() => null);
        const agentMode = settings?.localTerminalAgentMode ?? 'auto';
        if (agentMode === 'auto' || agentMode === 'app-managed') {
          const globalAgentSocket = await bridge.resolveLocalShellAgentSocket(settings?.smartcardAuthMode);
          if (globalAgentSocket) {
            ptyOptions = { ...ptyOptions, env: { SSH_AUTH_SOCK: globalAgentSocket, ...ptyOptions?.env } };
          }
        }
      }

      const session = options.local
        ? await bridge.sshPtyManager.createShellSession(ptyOptions)
        : await bridge.sshPtyManager.createSession(config!, ptyOptions);

      if (!options.local && config) {
        // Fire-and-forget: never let the dotfiles check delay or fail the
        // terminal session itself, and give the PTY a moment to become
        // interactive before a second connection competes for the network.
        const resolvedConfig = config;
        const sessionId = session.sessionId;
        setTimeout(() => {
          void bridge.runDotfilesSyncCheck(sessionId, resolvedConfig).catch(() => {});
        }, 1500);
      }

      return { sessionId: session.sessionId };
    }
  );

  bridge.registerHandler(
    IPC_CHANNELS.TERMINAL_WRITE,
    async (_event, sessionId: string, data: string) => {
      bridge.sshPtyManager.write(sessionId, data);
    }
  );

  bridge.registerHandler(
    IPC_CHANNELS.TERMINAL_RESIZE,
    async (_event, sessionId: string, cols: number, rows: number) => {
      bridge.sshPtyManager.resize(sessionId, cols, rows);
    }
  );

  bridge.registerHandler(
    IPC_CHANNELS.TERMINAL_KILL,
    async (_event, sessionId: string) => {
      bridge.sshPtyManager.kill(sessionId);
    }
  );

  bridge.registerHandler(
    IPC_CHANNELS.TERMINAL_RECONNECT,
    async (_event, sessionId: string) => {
      const session = bridge.sshPtyManager.getSession(sessionId);
      if (session && session.reconnect) {
        return await session.reconnect();
      }
      return false;
    }
  );
}
