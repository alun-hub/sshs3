import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { app } from 'electron';
import type { SessionData, PaneNode } from '../../shared/types/session';

function sanitizePaneNode(node: PaneNode): PaneNode {
  if (node.type === 'leaf') {
    if (!node.config) return node;
    const { password: _password, passphrase: _passphrase, ...restConfig } = node.config;
    return {
      ...node,
      config: restConfig,
    };
  }
  if (node.type === 'split' && Array.isArray(node.children)) {
    return {
      ...node,
      children: node.children.map(sanitizePaneNode),
    };
  }
  return node;
}

export function sanitizeSessionData(data: SessionData): SessionData {
  if (!data || !Array.isArray(data.tabs)) {
    return data;
  }
  return {
    ...data,
    tabs: data.tabs.map((tab) => {
      if (!tab.paneTree) return tab;
      return {
        ...tab,
        paneTree: sanitizePaneNode(tab.paneTree),
      };
    }),
  };
}

export class SessionStore {
  private filePath: string;
  private writeQueue: Promise<void> = Promise.resolve();

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
      this.filePath = path.join(baseDir, 'session.json');
    }
  }

  public getFilePath(): string {
    return this.filePath;
  }

  private getLegacyFilePath(): string | null {
    try {
      const configDir = path.dirname(this.filePath);
      const parent = path.dirname(configDir);
      const legacyConfig = path.join(parent, 'multissh', 'session.json');
      const legacyHome = path.join(os.homedir(), '.multissh', 'session.json');
      return legacyConfig !== this.filePath ? legacyConfig : legacyHome;
    } catch {
      return null;
    }
  }

  public async getSession(): Promise<SessionData | null> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8');
      const data = JSON.parse(raw);
      if (!data || !Array.isArray(data.tabs)) {
        return null;
      }
      return sanitizeSessionData(data as SessionData);
    } catch {
      const legacyPath = this.getLegacyFilePath();
      if (legacyPath) {
        try {
          const raw = await fs.readFile(legacyPath, 'utf-8');
          const data = JSON.parse(raw);
          if (data && Array.isArray(data.tabs)) {
            void this.saveSession(data as SessionData).catch(() => {});
            return sanitizeSessionData(data as SessionData);
          }
        } catch {
          // Ignore legacy read errors
        }
      }
      return null;
    }
  }

  public async saveSession(data: SessionData): Promise<void> {
    if (!data) return;
    const cleanData = sanitizeSessionData(data);

    return this.queueMutation(async () => {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      await fs.writeFile(this.filePath, JSON.stringify(cleanData, null, 2), {
        encoding: 'utf-8',
        mode: 0o600,
      });
      try {
        await fs.chmod(this.filePath, 0o600);
      } catch {
        // Ignore chmod failures on non-POSIX filesystems
      }
    });
  }

  private queueMutation<T>(mutation: () => Promise<T>): Promise<T> {
    const resultPromise = this.writeQueue.then(mutation, mutation);
    this.writeQueue = resultPromise.then(
      () => {},
      () => {}
    );
    return resultPromise;
  }
}
