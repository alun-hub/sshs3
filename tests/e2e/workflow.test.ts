import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { IpcBridge } from '../../src/main/IpcBridge';
import { IPC_CHANNELS } from '../../src/shared/types/ipc';

/**
 * Minimal ipcMain stand-in that lets the test drive IpcBridge exactly the way
 * the renderer's preload bridge does (invoke by channel name), without needing
 * a real Electron process.
 */
class FakeIpcMain {
  private handlers = new Map<string, (event: unknown, ...args: any[]) => any>();

  handle(channel: string, listener: (event: unknown, ...args: any[]) => any): void {
    this.handlers.set(channel, listener);
  }

  removeHandler(channel: string): void {
    this.handlers.delete(channel);
  }

  async invoke(channel: string, ...args: any[]): Promise<any> {
    const handler = this.handlers.get(channel);
    if (!handler) {
      throw new Error(`No handler registered for channel "${channel}"`);
    }
    return handler({}, ...args);
  }
}

describe('End-to-end workflow: connect, browse, transfer, and manage files', () => {
  let sourceDir: string;
  let targetDir: string;
  let ipcMain: FakeIpcMain;
  let bridge: IpcBridge;

  beforeEach(async () => {
    sourceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'multissh-e2e-src-'));
    targetDir = await fs.mkdtemp(path.join(os.tmpdir(), 'multissh-e2e-dst-'));

    ipcMain = new FakeIpcMain();
    bridge = new IpcBridge({
      ipcMain: ipcMain as any,
      getWebContents: () => undefined,
    });
    bridge.register();
  });

  afterEach(async () => {
    await bridge.dispose();
    await fs.rm(sourceDir, { recursive: true, force: true });
    await fs.rm(targetDir, { recursive: true, force: true });
  });

  it('moves a file from one connected storage provider to another end-to-end', async () => {
    const content = 'Hello from the MultiSSH end-to-end test\n';
    await fs.writeFile(path.join(sourceDir, 'hello.txt'), content, 'utf-8');

    // 1. Connect both storage endpoints, exactly like DualPaneExplorer does on mount.
    await ipcMain.invoke(IPC_CHANNELS.STORAGE_CONNECT, { id: 'src', name: 'Source', type: 'local', localBasePath: sourceDir });
    await ipcMain.invoke(IPC_CHANNELS.STORAGE_CONNECT, { id: 'dst', name: 'Target', type: 'local', localBasePath: targetDir });

    // 2. Browse the source pane.
    const entries = await ipcMain.invoke(IPC_CHANNELS.STORAGE_LIST, 'src', '');
    expect(entries).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'hello.txt', isDirectory: false })])
    );

    // 3. Drag-and-drop equivalent: request a transfer between the two panes.
    const { jobId } = await ipcMain.invoke(IPC_CHANNELS.TRANSFER_ADD, {
      sourceProviderId: 'src',
      sourcePath: 'hello.txt',
      targetProviderId: 'dst',
      targetPath: 'hello.txt',
    });
    expect(jobId).toBeTruthy();

    // 4. Wait for the real transfer pipeline to finish streaming the file.
    await bridge.transferQueue.waitForAll();

    const jobs = await ipcMain.invoke(IPC_CHANNELS.TRANSFER_GET_JOBS);
    const job = jobs.find((j: { jobId: string }) => j.jobId === jobId);
    expect(job).toMatchObject({ status: 'completed', percentage: 100 });

    // 5. Verify the bytes actually landed on the target storage.
    const transferred = await fs.readFile(path.join(targetDir, 'hello.txt'), 'utf-8');
    expect(transferred).toBe(content);
  });

  it('creates, renames, and deletes folders/files through the storage IPC surface', async () => {
    await ipcMain.invoke(IPC_CHANNELS.STORAGE_CONNECT, { id: 'dst', name: 'Target', type: 'local', localBasePath: targetDir });

    await ipcMain.invoke(IPC_CHANNELS.STORAGE_CREATE_FOLDER, 'dst', 'reports');
    await expect(fs.stat(path.join(targetDir, 'reports'))).resolves.toMatchObject({});

    await fs.writeFile(path.join(targetDir, 'reports', 'q1.txt'), 'draft', 'utf-8');

    await ipcMain.invoke(IPC_CHANNELS.STORAGE_RENAME, 'dst', 'reports/q1.txt', 'reports/q1-final.txt');
    await expect(fs.stat(path.join(targetDir, 'reports', 'q1.txt'))).rejects.toThrow();
    await expect(fs.readFile(path.join(targetDir, 'reports', 'q1-final.txt'), 'utf-8')).resolves.toBe('draft');

    await ipcMain.invoke(IPC_CHANNELS.STORAGE_DELETE, 'dst', 'reports/q1-final.txt', false);
    await ipcMain.invoke(IPC_CHANNELS.STORAGE_DELETE, 'dst', 'reports', true);
    await expect(fs.stat(path.join(targetDir, 'reports'))).rejects.toThrow();
  });

  it('reports application version and rejects unknown storage providers', async () => {
    const version = await ipcMain.invoke(IPC_CHANNELS.APP_GET_VERSION);
    expect(typeof version).toBe('string');

    await expect(ipcMain.invoke(IPC_CHANNELS.STORAGE_LIST, 'does-not-exist', '')).rejects.toThrow(
      /not found/i
    );
  });
});
