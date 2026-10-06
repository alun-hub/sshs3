import { IPC_CHANNELS } from '../../shared/types/ipc';
import type { IpcBridge } from '../IpcBridge';

/** The part of IpcBridge this handler group may use. */
export type FileEditorHost = Pick<
  IpcBridge,
  'fileEditorService' | 'fileTailService' | 'getWebContents' | 'registerHandler' | 'storageRegistry'
>;

export function registerFileEditorHandlers(bridge: FileEditorHost): void {
  bridge.registerHandler(
    IPC_CHANNELS.FILE_READ,
    async (_event, providerId: string, remotePath: string, maxBytes?: number) => {
      return await bridge.fileEditorService.readFile(
        bridge.storageRegistry,
        providerId,
        remotePath,
        maxBytes
      );
    }
  );

  bridge.registerHandler(
    IPC_CHANNELS.FILE_SAVE,
    async (_event, providerId: string, remotePath: string, content: string) => {
      await bridge.fileEditorService.saveFile(
        bridge.storageRegistry,
        providerId,
        remotePath,
        content
      );
    }
  );

  bridge.registerHandler(
    IPC_CHANNELS.FILE_OPEN_EXTERNAL,
    async (_event, providerId: string, remotePath: string) => {
      return await bridge.fileEditorService.openInExternalEditor(
        bridge.storageRegistry,
        providerId,
        remotePath,
        (statusEvent) => {
          const webContents = bridge.getWebContents();
          if (webContents && !webContents.isDestroyed?.()) {
            webContents.send(IPC_CHANNELS.FILE_EXTERNAL_STATUS, statusEvent);
          }
        }
      );
    }
  );

  bridge.registerHandler(
    IPC_CHANNELS.FILE_CLOSE_EXTERNAL,
    async (_event, sessionToken: string) => {
      await bridge.fileEditorService.closeExternalEditor(sessionToken);
    }
  );

  bridge.registerHandler(
    IPC_CHANNELS.FILE_TAIL_START,
    async (_event, providerId: string, remotePath: string) => {
      return await bridge.fileTailService.startTail(
        bridge.storageRegistry,
        providerId,
        remotePath,
        (dataEvent) => {
          const webContents = bridge.getWebContents();
          if (webContents && !webContents.isDestroyed?.()) {
            webContents.send(IPC_CHANNELS.FILE_TAIL_DATA, dataEvent);
          }
        },
        (errorEvent) => {
          const webContents = bridge.getWebContents();
          if (webContents && !webContents.isDestroyed?.()) {
            webContents.send(IPC_CHANNELS.FILE_TAIL_ERROR, errorEvent);
          }
        }
      );
    }
  );

  bridge.registerHandler(
    IPC_CHANNELS.FILE_TAIL_STOP,
    async (_event, tailId: string) => {
      bridge.fileTailService.stopTail(tailId);
    }
  );
}
