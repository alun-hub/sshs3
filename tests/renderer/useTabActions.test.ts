// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTabActions } from '../../src/renderer/src/lib/useTabActions';
import type { AppTab } from '../../src/renderer/src/lib/tabs';
import { DEFAULT_SETTINGS } from '../../src/shared/types/settings';

function setup(tabs: AppTab[], confirm: (o: unknown) => Promise<boolean> = vi.fn().mockResolvedValue(true)) {
  const setTabs = vi.fn();
  const setActiveTabId = vi.fn();
  const { result } = renderHook(() =>
    useTabActions({
      tabs,
      activeTabId: tabs[0].id,
      settings: DEFAULT_SETTINGS,
      localHostname: 'host',
      setTabs,
      setActiveTabId,
      setTabBarFocused: vi.fn(),
      setConnectTarget: vi.fn(),
      setProfilesModalOpen: vi.fn(),
      confirm,
    })
  );
  return { result, setTabs };
}

describe('useTabActions handleCloseTab', () => {
  const tabs = [
    { id: 'a', type: 'editor', title: 'notes.md', isDirty: true } as AppTab,
    { id: 'b', type: 'terminal', title: 'b' } as AppTab,
  ];

  it('asks once, naming the file, and keeps a dirty tab when the user cancels', async () => {
    const confirm = vi.fn().mockResolvedValue(false);
    const { result, setTabs } = setup(tabs, confirm);
    await act(async () => {
      await result.current.handleCloseTab('a');
    });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][0]).toMatchObject({
      message: 'Discard your unsaved changes to notes.md?',
      confirmLabel: 'Discard changes',
      cancelLabel: 'Keep editing',
    });
    expect(setTabs).not.toHaveBeenCalled();
  });

  it('closes the dirty tab once the user discards, and never confirms from inside the state updater', async () => {
    const confirm = vi.fn().mockResolvedValue(true);
    const { result, setTabs } = setup(tabs, confirm);
    await act(async () => {
      await result.current.handleCloseTab('a');
    });
    expect(confirm).toHaveBeenCalledTimes(1);
    const updater = setTabs.mock.calls[0][0] as (prev: AppTab[]) => AppTab[];
    const prev = [{ id: 'a' }, { id: 'b' }] as AppTab[];
    updater(prev);
    updater(prev);
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('closes a clean tab without asking', async () => {
    const confirm = vi.fn().mockResolvedValue(true);
    const { result, setTabs } = setup(tabs, confirm);
    await act(async () => {
      await result.current.handleCloseTab('b');
    });
    expect(confirm).not.toHaveBeenCalled();
    expect(setTabs).toHaveBeenCalledTimes(1);
  });
});

describe('useTabActions handleConnectS3', () => {
  it('opens a file manager tab focused on the S3 profile', () => {
    const { result, setTabs } = setup([{ id: 'a', type: 'terminal', title: 'a' } as AppTab]);
    const profile = { id: 'b1', name: 'Archive' } as any;
    act(() => result.current.handleConnectS3(profile));
    const updater = setTabs.mock.calls[0][0] as (prev: AppTab[]) => AppTab[];
    const next = updater([]);
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ type: 'filemanager', title: 'Archive (S3)', initialS3Config: profile });
  });
});

describe('useTabActions handleNewTab file manager', () => {
  const create = (remote?: boolean) => {
    const { result, setTabs } = setup([{ id: 'a', type: 'terminal', title: 'a' } as AppTab]);
    act(() => result.current.handleNewTab('filemanager', remote ? { remote: true } : undefined));
    return (setTabs.mock.calls[0][0] as (prev: AppTab[]) => AppTab[])([])[0];
  };

  it('opens locally by default and prompts for a connection when remote', () => {
    expect(create().promptRemote).toBeUndefined();
    expect(create(true).promptRemote).toBe(true);
  });
});
