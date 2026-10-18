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
