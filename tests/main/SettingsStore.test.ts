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

  describe('setTeamVaultTabVisible', () => {
    it('sets one vaultId entry in connectionManagerVisibleTeamVaults without touching others', async () => {
      await store.setTeamVaultTabVisible('vlt_a', false);
      await store.setTeamVaultTabVisible('vlt_b', true);
      const settings = await store.getSettings();
      expect(settings.connectionManagerVisibleTeamVaults).toEqual({ vlt_a: false, vlt_b: true });
    });

    it('never clobbers another team\'s entry even when two calls race on a stale read — the whole point of this atomic method over a renderer-side get/mutate/save round trip', async () => {
      // Seed one existing entry first, same as if a prior session had already toggled it.
      await store.setTeamVaultTabVisible('vlt_existing', true);

      // Two "concurrent" toggles for two different teams, fired without awaiting either first —
      // a plain settingsGet() -> mutate -> settingsSave() renderer round trip would have both
      // read the same pre-toggle snapshot and the second save to land would silently drop the
      // first toggle's change. This method's own internal queueMutation must serialize the two
      // read-modify-writes instead.
      await Promise.all([store.setTeamVaultTabVisible('vlt_a', false), store.setTeamVaultTabVisible('vlt_b', true)]);

      const settings = await store.getSettings();
      expect(settings.connectionManagerVisibleTeamVaults).toEqual({
        vlt_existing: true,
        vlt_a: false,
        vlt_b: true,
      });
    });

    it('leaves every other setting untouched', async () => {
      await store.saveSettings({ theme: 'light' });
      await store.setTeamVaultTabVisible('vlt_a', false);
      const settings = await store.getSettings();
      expect(settings.theme).toBe('light');
    });
  });
});
