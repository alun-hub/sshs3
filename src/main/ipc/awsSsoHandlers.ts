import crypto from 'node:crypto';
import { shell as electronShell } from 'electron';
import { AwsSsoLoginCancelledError } from '../aws/AwsSsoAuthService';
import { IPC_CHANNELS, type AwsSsoPromptEvent } from '../../shared/types/ipc';
import type { AwsSsoAccount, AwsSsoAccountRole, AwsSsoLoginResult } from '../../shared/types/aws';
import type { IpcBridge } from '../IpcBridge';

/** The part of IpcBridge this handler group may use. */
export type AwsSsoHost = Pick<
  IpcBridge,
  'awsSsoAuthService' | 'getWebContents' | 'pendingAwsSsoLogins' | 'registerHandler'
>;

/**
 * Runs the AWS SSO device-authorization flow and resolves once the user
 * approves it in their browser. Mirrors `promptHostKeyTrust`'s pattern of
 * leaving a single long-lived `ipcMain.handle` invoke pending, but also
 * supports cancellation via a separate channel since this wait can be
 * minutes rather than a single click.
 */
export function registerAwsSsoHandlers(bridge: AwsSsoHost): void {
  bridge.registerHandler(
    IPC_CHANNELS.AWS_SSO_LOGIN,
    async (_event, startUrl: string, region: string): Promise<AwsSsoLoginResult> => {
      if (!startUrl?.trim() || !region?.trim()) {
        throw new Error('Start URL and region are required');
      }

      const id = crypto.randomUUID();
      const controller = new AbortController();
      bridge.pendingAwsSsoLogins.set(id, { cancel: () => controller.abort() });

      try {
        return await bridge.awsSsoAuthService.login(startUrl, region, {
          onPrompt: (prompt) => {
            const urlToOpen = prompt.verificationUriComplete || prompt.verificationUri;
            if (
              urlToOpen &&
              (urlToOpen.startsWith('http://') || urlToOpen.startsWith('https://')) &&
              electronShell?.openExternal
            ) {
              void electronShell.openExternal(urlToOpen).catch(() => {});
            }
            const webContents = bridge.getWebContents();
            if (webContents && !webContents.isDestroyed?.()) {
              const event: AwsSsoPromptEvent = { id, ...prompt };
              webContents.send(IPC_CHANNELS.AWS_SSO_PROMPT, event);
            }
          },
          signal: controller.signal,
        });
      } catch (err) {
        if (err instanceof AwsSsoLoginCancelledError) {
          throw new Error('AWS SSO login was cancelled', { cause: err });
        }
        throw err;
      } finally {
        bridge.pendingAwsSsoLogins.delete(id);
      }
    }
  );

  bridge.registerHandler(IPC_CHANNELS.AWS_SSO_LOGIN_CANCEL, async (_event, id: string) => {
    const pending = bridge.pendingAwsSsoLogins.get(id);
    pending?.cancel();
  });

  bridge.registerHandler(
    IPC_CHANNELS.AWS_SSO_LIST_ACCOUNTS,
    async (_event, accessToken: string, region: string): Promise<AwsSsoAccount[]> => {
      return await bridge.awsSsoAuthService.listAccounts(accessToken, region);
    }
  );

  bridge.registerHandler(
    IPC_CHANNELS.AWS_SSO_LIST_ROLES,
    async (_event, accessToken: string, region: string, accountId: string): Promise<AwsSsoAccountRole[]> => {
      return await bridge.awsSsoAuthService.listAccountRoles(accessToken, region, accountId);
    }
  );
}
