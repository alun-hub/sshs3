import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { app } from 'electron';
import {
  CLIPBOARD_HISTORY_MAX_ENTRIES,
  CLIPBOARD_HISTORY_MAX_ENTRY_CHARS,
  type ClipboardHistoryEntry,
} from '../../shared/types/clipboard';
import { decryptSecretValue, encryptSecretValue, isEncryptionAvailable } from '../crypto/SecretFieldCrypto';

/**
 * Persistent history of terminal selections. Copied text routinely contains
 * passwords and tokens, so the whole list is encrypted with the OS keyring
 * (safeStorage) before it touches disk. Fail closed: with no keyring available
 * the history stays in memory only and nothing is written.
 */
export class ClipboardHistoryStore {
  private filePath: string;
  private writeQueue: Promise<void> = Promise.resolve();
  private cache: ClipboardHistoryEntry[] | null = null;

  constructor(customPath?: string) {
    if (customPath) {
      this.filePath = customPath;
    } else {
      let baseDir: string;
      try {
        baseDir = app.getPath('userData');
      } catch {
        baseDir = path.join(os.homedir(), '.sshs3');
      }
      this.filePath = path.join(baseDir, 'clipboard-history.json');
    }
  }

  private queueMutation<T>(mutation: () => Promise<T>): Promise<T> {
    const resultPromise = this.writeQueue.then(mutation, mutation);
    this.writeQueue = resultPromise.then(
      () => {},
      () => {}
    );
    return resultPromise;
  }

  private isEntry(value: unknown): value is ClipboardHistoryEntry {
    const e = value as ClipboardHistoryEntry;
    return (
      !!e &&
      typeof e.id === 'string' &&
      typeof e.text === 'string' &&
      typeof e.copiedAt === 'string' &&
      typeof e.hostKey === 'string' &&
      typeof e.hostLabel === 'string'
    );
  }

  private async load(): Promise<ClipboardHistoryEntry[]> {
    if (this.cache) return this.cache;
    let entries: ClipboardHistoryEntry[] = [];
    try {
      const raw = JSON.parse(await fs.readFile(this.filePath, 'utf-8'));
      const payload = typeof raw?.data === 'string' ? decryptSecretValue(raw.data) : '';
      const parsed = payload ? JSON.parse(payload) : [];
      if (Array.isArray(parsed)) entries = parsed.filter((e) => this.isEntry(e));
    } catch {
      // Missing, corrupted or undecryptable file: start with an empty history.
    }
    this.cache = entries;
    return entries;
  }

  private async persist(entries: ClipboardHistoryEntry[]): Promise<void> {
    if (!isEncryptionAvailable()) return;
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const body = JSON.stringify({ version: 1, data: encryptSecretValue(JSON.stringify(entries)) });
    const tmp = `${this.filePath}.tmp`;
    await fs.writeFile(tmp, body, { encoding: 'utf-8', mode: 0o600 });
    await fs.rename(tmp, this.filePath);
  }

  /** Newest first. With `hostKey`, only entries copied on that host. */
  public async list(hostKey?: string): Promise<ClipboardHistoryEntry[]> {
    await this.writeQueue;
    const entries = await this.load();
    return hostKey ? entries.filter((e) => e.hostKey === hostKey) : [...entries];
  }

  public async add(text: string, hostKey: string, hostLabel: string): Promise<void> {
    if (!text || text.length > CLIPBOARD_HISTORY_MAX_ENTRY_CHARS) return;
    return this.queueMutation(async () => {
      const entries = (await this.load()).filter((e) => !(e.text === text && e.hostKey === hostKey));
      entries.unshift({
        id: crypto.randomUUID(),
        text,
        copiedAt: new Date().toISOString(),
        hostKey,
        hostLabel,
      });
      this.cache = entries.slice(0, CLIPBOARD_HISTORY_MAX_ENTRIES);
      await this.persist(this.cache);
    });
  }

  public async delete(id: string): Promise<void> {
    return this.queueMutation(async () => {
      this.cache = (await this.load()).filter((e) => e.id !== id);
      await this.persist(this.cache);
    });
  }

  public async clear(): Promise<void> {
    return this.queueMutation(async () => {
      this.cache = [];
      await this.persist(this.cache);
    });
  }
}
