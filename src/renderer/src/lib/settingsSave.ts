import type { AppSettings } from '@shared/types/settings';

/**
 * Settings that something other than the Settings form writes straight to the main process (the Team
 * Vault "show as tab" toggle, the Connection Manager's default tab). The app's copy of them goes stale
 * the moment that happens, so a save from the form must not send them back: the main process merges at
 * the top level and would put the old value over the new one.
 */
const WRITTEN_ELSEWHERE = ['connectionManagerVisibleTeamVaults', 'connectionManagerDefaultTab'] as const;

/** What to send for a save of the whole Settings form: everything the form owns, nothing it merely holds. */
export function settingsPatchFromForm(settings: AppSettings): Partial<AppSettings> {
  const patch: Partial<AppSettings> = { ...settings };
  for (const key of WRITTEN_ELSEWHERE) delete patch[key];
  return patch;
}

/**
 * The app's settings after a save came back: the keys that were sent take the value the main process
 * kept (a policy-managed key keeps the administrator's value), and the keys written elsewhere are
 * refreshed. Everything else is left alone, so a change made while the save was under way is not undone.
 */
export function mergeSavedSettings(current: AppSettings, saved: AppSettings, sent: Partial<AppSettings>): AppSettings {
  const next: AppSettings = { ...current };
  const assign = <K extends keyof AppSettings>(key: K) => {
    next[key] = saved[key];
  };
  (Object.keys(sent) as Array<keyof AppSettings>).forEach(assign);
  WRITTEN_ELSEWHERE.forEach(assign);
  return next;
}
