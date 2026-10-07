import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const IPC_DIR = path.join(__dirname, '../../src/main/ipc');

/** Prompt maps on IpcBridge: only the listed handler groups may use them. */
const GUARDED: Record<string, string[]> = {
  pendingAskpass: ['smartcardHandlers'],
  pendingHostKeyPrompts: ['smartcardHandlers'],
  pendingTransferConflicts: ['transferHandlers'],
  pendingQuitConfirms: ['transferHandlers'],
  pendingDotfilesSyncPrompts: ['dotfileHandlers'],
  pendingAwsSsoLogins: ['awsSsoHandlers'],
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

  it('never reads the SmartcardCoordinator state directly, only its methods', () => {
    const STATE = [
      'appAgent',
      'globalCards',
      'smartcardSessionAgents',
      'agentConfigRefresh',
      'globalSmartcardAgentLoads',
      'globalSmartcardAgentFailures',
      'startupUnlockPromise',
      'globalSmartcardCerts',
      'prefetchedSmartcardCerts',
    ];
    for (const file of handlerFiles()) {
      const src = fs.readFileSync(path.join(IPC_DIR, file), 'utf-8');
      for (const member of STATE) {
        expect(src, `${file} reads smartcard.${member}`).not.toMatch(new RegExp(`\\bsmartcard\\.${member}\\b`));
      }
    }
  });

  it('gives each handler group a Pick<SmartcardCoordinator, ...> of exactly the coordinator methods it calls', () => {
    for (const file of handlerFiles()) {
      const src = fs.readFileSync(path.join(IPC_DIR, file), 'utf-8');
      const used = [...new Set([...src.matchAll(/\bbridge\.smartcard\.(\w+)/g)].map((m) => m[1]))];
      if (used.length === 0) continue;
      const decl = src.match(/smartcard: Pick<\s*SmartcardCoordinator,\s*([^>]*?)\s*>/);
      expect(decl, `${file} must declare smartcard: Pick<SmartcardCoordinator, ...>`).not.toBeNull();
      const declared = [...decl![1].matchAll(/'(\w+)'/g)].map((m) => m[1]);
      expect(declared.sort(), file).toEqual(used.sort());
    }
  });
});
