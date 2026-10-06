import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const IPC_DIR = path.join(__dirname, '../../src/main/ipc');

/** Members holding PIN prompts, agent state or cached card data: only the listed handler groups may use them. */
const GUARDED: Record<string, string[]> = {
  pendingAskpass: ['smartcardHandlers'],
  pendingHostKeyPrompts: ['smartcardHandlers'],
  pendingTransferConflicts: ['transferHandlers'],
  pendingQuitConfirms: ['transferHandlers'],
  pendingDotfilesSyncPrompts: ['dotfileHandlers'],
  pendingAwsSsoLogins: ['awsSsoHandlers'],
  appAgent: ['keyInstallHandlers', 'syncHandlers'],
  globalCards: ['keyInstallHandlers', 'syncHandlers'],
  smartcardSessionAgents: ['keyInstallHandlers'],
  startupUnlockPromise: ['storageHandlers', 'terminalHandlers'],
};

function handlerFiles(): string[] {
  return fs.readdirSync(IPC_DIR).filter((f) => f.endsWith('Handlers.ts'));
}

describe('ipc handler groups only see the part of IpcBridge they need', () => {
  it('declares a Pick<IpcBridge, ...> host type that covers every bridge member it uses', () => {
    for (const file of handlerFiles()) {
      const src = fs.readFileSync(path.join(IPC_DIR, file), 'utf-8');
      expect(src, file).toMatch(/export type \w+Host = Pick</);
      expect(src, file).not.toMatch(/\(bridge: IpcBridge\)/);
    }
  });

  it('keeps the prompt maps and agent state within their owning handler groups', () => {
    for (const [member, owners] of Object.entries(GUARDED)) {
      const users = handlerFiles()
        .filter((file) => new RegExp(`\\bbridge\\.${member}\\b`).test(fs.readFileSync(path.join(IPC_DIR, file), 'utf-8')))
        .map((file) => file.replace('.ts', ''));
      for (const user of users) {
        expect(owners, `${member} is used by ${user}`).toContain(user);
      }
    }
  });
});
