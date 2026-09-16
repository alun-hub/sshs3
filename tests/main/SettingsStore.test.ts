import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { SettingsStore } from '../../src/main/settings/SettingsStore';
import { DEFAULT_SETTINGS } from '../../src/shared/types/settings';

describe('SettingsStore', () => {
  let tempDir: string;
  let settingsFile: string;
  let store: SettingsStore;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'multissh-settings-test-'));
    settingsFile = path.join(tempDir, 'settings.json');
    store = new SettingsStore(settingsFile);
  });

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('returns default settings when file does not exist', async () => {
    const settings = await store.getSettings();
    expect(settings).toEqual(DEFAULT_SETTINGS);
  });

  it('saves partial settings and updates values while retaining defaults', async () => {
    await store.saveSettings({ theme: 'light', terminalFontSize: 16 });
    const settings = await store.getSettings();

    expect(settings.theme).toBe('light');
    expect(settings.terminalFontSize).toBe(16);
    expect(settings.terminalFontFamily).toBe(DEFAULT_SETTINGS.terminalFontFamily);
    expect(settings.defaultNewTabType).toBe(DEFAULT_SETTINGS.defaultNewTabType);
  });

  it('updates defaultNewTabType setting', async () => {
    await store.saveSettings({ defaultNewTabType: 'filemanager' });
    const settings = await store.getSettings();

    expect(settings.defaultNewTabType).toBe('filemanager');
  });
});
