import { IPC_CHANNELS } from '../../shared/types/ipc';
import type { IpcBridge } from '../IpcBridge';

/** The part of IpcBridge this handler group may use. */
export type FileEditorHost = Pick<
  IpcBridge,
  'fileEditorService' | 'fileTailService' | 'registerHandler' | 'sendToSender' | 'storageRegistry'
>;

async function ensureLocalProvider(bridge: FileEditorHost, providerId: string): Promise<void> {
  if (providerId === 'local' && !bridge.storageRegistry.has('local')) {
    await bridge.storageRegistry.getOrCreate({ id: 'local', name: 'Local Disk', type: 'local' });
  }
}

export function registerFileEditorHandlers(bridge: FileEditorHost): void {
  bridge.registerHandler(
    IPC_CHANNELS.FILE_READ,
    async (_event, providerId: string, remotePath: string, maxBytes?: number) => {
      await ensureLocalProvider(bridge, providerId);
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
      await ensureLocalProvider(bridge, providerId);
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
    async (event, providerId: string, remotePath: string) => {
      const sender = event?.sender;
      await ensureLocalProvider(bridge, providerId);
      return await bridge.fileEditorService.openInExternalEditor(
        bridge.storageRegistry,
        providerId,
        remotePath,
        (statusEvent) => {
          bridge.sendToSender(sender, IPC_CHANNELS.FILE_EXTERNAL_STATUS, statusEvent);
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
    async (event, providerId: string, remotePath: string) => {
      const sender = event?.sender;
      await ensureLocalProvider(bridge, providerId);
      return await bridge.fileTailService.startTail(
        bridge.storageRegistry,
        providerId,
        remotePath,
        (dataEvent) => {
          bridge.sendToSender(sender, IPC_CHANNELS.FILE_TAIL_DATA, dataEvent);
        },
        (errorEvent) => {
          bridge.sendToSender(sender, IPC_CHANNELS.FILE_TAIL_ERROR, errorEvent);
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
