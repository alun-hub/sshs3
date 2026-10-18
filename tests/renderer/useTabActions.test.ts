// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTabActions } from '../../src/renderer/src/lib/useTabActions';
import type { AppTab } from '../../src/renderer/src/lib/tabs';
import { DEFAULT_SETTINGS } from '../../src/shared/types/settings';

function setup(tabs: AppTab[]) {
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
    })
  );
  return { result, setTabs };
}

describe('useTabActions handleCloseTab', () => {
  afterEach(() => vi.restoreAllMocks());

  it('asks once and keeps a dirty tab when the user cancels', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { result, setTabs } = setup([
      { id: 'a', type: 'editor', title: 'a', isDirty: true } as AppTab,
      { id: 'b', type: 'terminal', title: 'b' } as AppTab,
    ]);
    act(() => result.current.handleCloseTab('a'));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(setTabs).not.toHaveBeenCalled();
  });

  it('does not call confirm from inside the state updater', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { result, setTabs } = setup([
      { id: 'a', type: 'editor', title: 'a', isDirty: true } as AppTab,
      { id: 'b', type: 'terminal', title: 'b' } as AppTab,
    ]);
    act(() => result.current.handleCloseTab('a'));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    const updater = setTabs.mock.calls[0][0] as (prev: AppTab[]) => AppTab[];
    const prev = [{ id: 'a' }, { id: 'b' }] as AppTab[];
    updater(prev);
    updater(prev);
    expect(confirmSpy).toHaveBeenCalledTimes(1);
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
