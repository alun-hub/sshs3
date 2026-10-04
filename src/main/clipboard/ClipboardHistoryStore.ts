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

const ENCRYPTED_PREFIX = 'enc:v1:';

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
  private loading: Promise<ClipboardHistoryEntry[]> | null = null;

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

  // One shared read: a second caller must not overwrite a cache a mutation has updated meanwhile.
  private load(): Promise<ClipboardHistoryEntry[]> {
    if (this.cache) return Promise.resolve(this.cache);
    this.loading ??= this.readFromDisk().then((entries) => {
      this.cache ??= entries;
      this.loading = null;
      return this.cache;
    });
    return this.loading;
  }

  private async readFromDisk(): Promise<ClipboardHistoryEntry[]> {
    let entries: ClipboardHistoryEntry[] = [];
    try {
      const raw = JSON.parse(await fs.readFile(this.filePath, 'utf-8'));
      const payload = typeof raw?.data === 'string' ? decryptSecretValue(raw.data) : '';
      const parsed = payload ? JSON.parse(payload) : [];
      if (Array.isArray(parsed)) entries = parsed.filter((e) => this.isEntry(e));
    } catch {
      // Missing, corrupted or undecryptable file: start with an empty history.
    }
    return entries;
  }

  private async removeFile(): Promise<void> {
    await fs.rm(this.filePath, { force: true });
    await fs.rm(`${this.filePath}.tmp`, { force: true });
  }

  private async persist(entries: ClipboardHistoryEntry[]): Promise<void> {
    // encryptSecretValue falls back to plaintext when encryption fails, so verify the result
    // really is ciphertext before writing. Anything else must never reach the disk; also drop a
    // file left over from a time when a keyring was available, so it can't outlive "clear".
    const encrypted = isEncryptionAvailable() ? encryptSecretValue(JSON.stringify(entries)) : '';
    if (!encrypted.startsWith(ENCRYPTED_PREFIX)) {
      await this.removeFile();
      return;
    }
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const body = JSON.stringify({ version: 1, data: encrypted });
    const tmp = `${this.filePath}.tmp`;
    await fs.writeFile(tmp, body, { encoding: 'utf-8', mode: 0o600 });
    await fs.rename(tmp, this.filePath);
  }

  /** Newest first. With `hostKey`, only entries copied on that host. */
  public async list(hostKey?: string): Promise<ClipboardHistoryEntry[]> {
    await this.writeQueue;
    const entries = await this.load();
    return hostKey !== undefined ? entries.filter((e) => e.hostKey === hostKey) : [...entries];
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
