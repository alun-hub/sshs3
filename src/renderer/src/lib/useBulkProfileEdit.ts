import { useCallback, useMemo, useRef, useState } from 'react';
import { describeIpcError } from './format';
import { normalizeFolderName, withAddedTags, withGroup } from './bulkProfileEdit';

interface BulkProfile {
  id: string;
  group?: string;
  tags?: string[];
}

interface UseBulkProfileEditOptions<T extends BulkProfile> {
  /** The profiles of the list being shown (one protocol, one source); a selected id that leaves it is forgotten. */
  profiles: readonly T[];
  /** Saves one profile through the same path a drag and drop uses (personal store, or the Team Vault). */
  save: (profile: T) => Promise<unknown>;
  /** Reads the list again after profiles were saved. */
  reload: () => Promise<void>;
  onError: (message: string) => void;
}

const plural = (n: number) => `${n} profile${n === 1 ? '' : 's'}`;

/**
 * Checkbox selection over a list of profiles, and the two edits that work on the whole selection:
 * move to a folder and add tags. Profiles are saved one at a time, in order, through `save`; the
 * first failure stops the run (what was saved is reloaded) and keeps the selection so it can be
 * retried. Only profiles that would actually change are saved, so a Team Vault revision is not
 * bumped for nothing.
 */
export function useBulkProfileEdit<T extends BulkProfile>({ profiles, save, reload, onError }: UseBulkProfileEditOptions<T>) {
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const selection = useMemo(() => {
    const ids = new Set(profiles.map((p) => p.id));
    return new Set([...chosen].filter((id) => ids.has(id)));
  }, [chosen, profiles]);

  const toggle = useCallback((id: string) => {
    setNotice(null);
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setNotice(null);
    setChosen(new Set());
  }, []);

  /**
   * Saves `changed` in order. Resolves true when all were saved; on the first failure it stops, reloads
   * what was saved and only then reports the error (reloading usually clears the error showing), and
   * resolves false.
   */
  const saveAll = async (changed: T[], failure: string): Promise<boolean> => {
    let message: string | null = null;
    try {
      for (const profile of changed) await save(profile);
    } catch (err) {
      message = describeIpcError(err, failure);
    }
    await reload();
    if (message !== null) onError(message);
    return message === null;
  };

  const run = async (work: () => Promise<void>) => {
    if (busyRef.current || selection.size === 0) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await work();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const moveTo = (rawFolder: string) =>
    run(async () => {
      const folder = normalizeFolderName(rawFolder);
      const changed = withGroup(profiles, selection, folder);
      if (changed.length === 0) {
        setNotice(folder ? `Already in "${folder}".` : 'None of them is in a folder.');
        return;
      }
      if (await saveAll(changed, 'Failed to move the profiles')) {
        setChosen(new Set());
        setNotice(folder ? `Moved ${plural(changed.length)} to "${folder}".` : `Moved ${plural(changed.length)} out of ${changed.length === 1 ? 'its' : 'their'} folder.`);
      }
    });

  const addTags = (tags: readonly string[]) =>
    run(async () => {
      const changed = withAddedTags(profiles, selection, tags);
      if (changed.length === 0) {
        setNotice('They already have those tags.');
        return;
      }
      if (await saveAll(changed, 'Failed to add the tags')) {
        setChosen(new Set());
        setNotice(`Added tags to ${plural(changed.length)}.`);
      }
    });

  return {
    count: selection.size,
    isSelected: (id: string) => selection.has(id),
    /** What a profile row needs to show and toggle its checkbox. */
    rowSelect: (id: string) => ({ checked: selection.has(id), anyChecked: selection.size > 0, onToggle: () => toggle(id) }),
    toggle,
    clear,
    moveTo,
    addTags,
    busy,
    notice,
  };
}
