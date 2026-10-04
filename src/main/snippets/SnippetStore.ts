import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { app } from 'electron';
import {
  SNIPPETS_MAX_COUNT,
  SNIPPET_MAX_COMMAND_CHARS,
  SNIPPET_MAX_NAME_CHARS,
  type Snippet,
} from '../../shared/types/snippets';

/** Saved terminal command snippets. Stored as plain JSON: snippets are commands, not secrets. */
export class SnippetStore {
  private filePath: string;
  private writeQueue: Promise<void> = Promise.resolve();
  private cache: Snippet[] | null = null;

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
      this.filePath = path.join(baseDir, 'snippets.json');
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

  private isSnippet(value: unknown): value is Snippet {
    const s = value as Snippet;
    return (
      !!s &&
      typeof s.id === 'string' &&
      typeof s.name === 'string' &&
      typeof s.command === 'string' &&
      (s.hostKey === undefined || typeof s.hostKey === 'string') &&
      (s.hostLabel === undefined || typeof s.hostLabel === 'string')
    );
  }

  private async load(): Promise<Snippet[]> {
    if (this.cache) return this.cache;
    let snippets: Snippet[] = [];
    try {
      const parsed = JSON.parse(await fs.readFile(this.filePath, 'utf-8'));
      if (Array.isArray(parsed?.snippets)) snippets = parsed.snippets.filter((s: unknown) => this.isSnippet(s));
    } catch {
      // Missing or corrupted file: start empty.
    }
    this.cache ??= snippets;
    return this.cache;
  }

  private async persist(snippets: Snippet[]): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify({ version: 1, snippets }, null, 2), { encoding: 'utf-8', mode: 0o600 });
    await fs.rename(tmp, this.filePath);
  }

  /** All snippets, or with `hostKey` only the global ones plus those limited to that connection. */
  public async list(hostKey?: string): Promise<Snippet[]> {
    await this.writeQueue;
    const snippets = await this.load();
    return snippets.filter((s) => hostKey === undefined || !s.hostKey || s.hostKey === hostKey);
  }

  /** Inserts a new snippet (no/unknown id) or replaces the existing one with that id. */
  public async save(input: Omit<Snippet, 'id'> & { id?: string }): Promise<Snippet> {
    const name = input.name.trim().slice(0, SNIPPET_MAX_NAME_CHARS);
    if (!name || !input.command.trim() || input.command.length > SNIPPET_MAX_COMMAND_CHARS) {
      throw new Error('Invalid snippet');
    }
    return this.queueMutation(async () => {
      const snippets = await this.load();
      const existing = input.id ? snippets.findIndex((s) => s.id === input.id) : -1;
      const snippet: Snippet = {
        id: existing >= 0 ? snippets[existing].id : crypto.randomUUID(),
        name,
        command: input.command,
        ...(input.hostKey ? { hostKey: input.hostKey, hostLabel: input.hostLabel ?? '' } : {}),
      };
      if (existing < 0 && snippets.length >= SNIPPETS_MAX_COUNT) throw new Error('Too many snippets');
      const next = existing >= 0 ? snippets.map((s, i) => (i === existing ? snippet : s)) : [...snippets, snippet];
      await this.persist(next);
      this.cache = next;
      return snippet;
    });
  }

  public async delete(id: string): Promise<void> {
    return this.queueMutation(async () => {
      const next = (await this.load()).filter((s) => s.id !== id);
      await this.persist(next);
      this.cache = next;
    });
  }
}
