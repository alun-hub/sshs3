import type { SearchStartOptions } from '../../shared/types/search';
import { IPC_CHANNELS } from '../../shared/types/ipc';
import type { IpcBridge } from '../IpcBridge';

export function registerSearchHandlers(bridge: IpcBridge): void {
  bridge.registerHandler(
    IPC_CHANNELS.SEARCH_START,
    async (_event, options: SearchStartOptions) => {
      return await bridge.searchOrchestrator.startSearch(
        bridge.storageRegistry,
        options,
        (resultEvent) => {
          const webContents = bridge.getWebContents();
          if (webContents && !webContents.isDestroyed?.()) {
            webContents.send(IPC_CHANNELS.SEARCH_RESULT, resultEvent);
          }
        },
        (errorEvent) => {
          const webContents = bridge.getWebContents();
          if (webContents && !webContents.isDestroyed?.()) {
            webContents.send(IPC_CHANNELS.SEARCH_ERROR, errorEvent);
          }
        },
        (doneEvent) => {
          const webContents = bridge.getWebContents();
          if (webContents && !webContents.isDestroyed?.()) {
            webContents.send(IPC_CHANNELS.SEARCH_DONE, doneEvent);
          }
        },
        (progressEvent) => {
          const webContents = bridge.getWebContents();
          if (webContents && !webContents.isDestroyed?.()) {
            webContents.send(IPC_CHANNELS.SEARCH_PROGRESS, progressEvent);
          }
        }
      );
    }
  );

  bridge.registerHandler(
    IPC_CHANNELS.SEARCH_CANCEL,
    async (_event, searchId: string) => {
      bridge.searchOrchestrator.cancelSearch(searchId);
    }
  );

  bridge.registerHandler(
    IPC_CHANNELS.SEARCH_PREVIEW,
    async (_event, providerId: string, remotePath: string, lineNumber: number, contextLines: number) => {
      return await bridge.searchOrchestrator.previewLines(
        bridge.storageRegistry,
        providerId,
        remotePath,
        lineNumber,
        contextLines
      );
    }
  );
}
