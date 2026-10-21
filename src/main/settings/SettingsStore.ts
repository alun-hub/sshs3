import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { app } from 'electron';
import { DEFAULT_SETTINGS, type AppSettings } from '../../shared/types/settings';

/**
 * The settings UI saves the whole shortcut map, defaults included, so a binding that was still the
 * default when it was saved keeps overriding a later change of that default. A value equal to a
 * previous default is indistinguishable from an untouched one, so it is dropped to let the
 * current default apply.
 */
const SUPERSEDED_DEFAULT_SHORTCUTS: Record<string, string[]> = {
  closeTab: ['Ctrl+W'],
  copyLastOutput: ['Ctrl+Shift+G', 'Alt+C'],
  rerunWithSudo: ['Alt+S'],
};

export function migrateShortcuts<T extends { shortcuts?: Record<string, string> }>(data: T): T {
  const shortcuts = data?.shortcuts;
  if (!shortcuts || typeof shortcuts !== 'object') return data;
  const kept = Object.fromEntries(
    Object.entries(shortcuts).filter(([id, keys]) => !SUPERSEDED_DEFAULT_SHORTCUTS[id]?.includes(keys))
  );
  return Object.keys(kept).length === Object.keys(shortcuts).length ? data : { ...data, shortcuts: kept };
}

export class SettingsStore {
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
      this.filePath = path.join(baseDir, 'settings.json');
    }
  }

  public getFilePath(): string {
    return this.filePath;
  }

  private getLegacyFilePath(): string | null {
    try {
      const configDir = path.dirname(this.filePath);
      const parent = path.dirname(configDir);
      const legacyConfig = path.join(parent, 'multissh', 'settings.json');
      const legacyHome = path.join(os.homedir(), '.multissh', 'settings.json');
      return legacyConfig !== this.filePath ? legacyConfig : legacyHome;
    } catch {
      return null;
    }
  }

  public async getSettings(): Promise<AppSettings> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8');
      const data = migrateShortcuts(JSON.parse(raw));
      return {
        ...DEFAULT_SETTINGS,
        ...data,
      };
    } catch {
      const legacyPath = this.getLegacyFilePath();
      if (legacyPath) {
        try {
          const raw = await fs.readFile(legacyPath, 'utf-8');
          const data = JSON.parse(raw);
          const loaded = {
            ...DEFAULT_SETTINGS,
            ...data,
          };
          void this.saveSettings(loaded).catch(() => {});
          return loaded;
        } catch {
          // Ignore legacy read errors
        }
      }
      return { ...DEFAULT_SETTINGS };
    }
  }

  /**
   * @param options.preserveTimestamp When true, don't stamp `updatedAt` with
   *   "now". Used exclusively by remote profile sync when writing back the
   *   winning side's settings object as-is.
   */
  public async saveSettings(
    partial: Partial<AppSettings>,
    options?: { preserveTimestamp?: boolean }
  ): Promise<AppSettings> {
    return this.queueMutation(async () => {
      const current = await this.getSettings();
      const updated: AppSettings = {
        ...current,
        ...partial,
        updatedAt: options?.preserveTimestamp ? (partial.updatedAt ?? current.updatedAt) : new Date().toISOString(),
      };
      return this.persist(updated);
    });
  }

  /**
   * Atomically flips one team's entry in `connectionManagerVisibleTeamVaults` — unlike a
   * renderer doing its own `settingsGet()` -> mutate the map -> `settingsSave()` round trip, the
   * read-modify-write here happens entirely inside this store's own `queueMutation` lock, so two
   * calls for two different vaultIds (e.g. two Team Vault detail panels toggled in quick
   * succession) can never race on a stale snapshot and have one overwrite the other's change —
   * `saveSettings`'s top-level merge replaces this nested map wholesale from whatever the caller
   * last read, which is exactly the gap this closes. Per CLAUDE.md: "Alla stores använder
   * `queueMutation` för sekventiella skrivningar."
   */
  public async setTeamVaultTabVisible(vaultId: string, visible: boolean): Promise<AppSettings> {
    return this.queueMutation(async () => {
      const current = await this.getSettings();
      const updated: AppSettings = {
        ...current,
        connectionManagerVisibleTeamVaults: {
          ...current.connectionManagerVisibleTeamVaults,
          [vaultId]: visible,
        },
        updatedAt: new Date().toISOString(),
      };
      return this.persist(updated);
    });
  }

  /** Shared disk-write tail for `saveSettings`/`setTeamVaultTabVisible` — both already compute
   * `updated` under this store's `queueMutation` lock; this only persists it. */
  private async persist(updated: AppSettings): Promise<AppSettings> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(updated, null, 2), {
      encoding: 'utf-8',
      mode: 0o600,
    });
    try {
      await fs.chmod(this.filePath, 0o600);
    } catch {
      // Ignore chmod failures on non-POSIX filesystems
    }
    return updated;
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
