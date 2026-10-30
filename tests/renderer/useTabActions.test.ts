// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTabActions } from '../../src/renderer/src/lib/useTabActions';
import type { AppTab } from '../../src/renderer/src/lib/tabs';
import { DEFAULT_SETTINGS } from '../../src/shared/types/settings';

function setup(tabs: AppTab[], confirm: (o: unknown) => Promise<boolean> = vi.fn().mockResolvedValue(true)) {
  const setTabs = vi.fn();
  const setActiveTabId = vi.fn();
  const setConnectTarget = vi.fn();
  const setProfilesModalOpen = vi.fn();
  const { result } = renderHook(() =>
    useTabActions({
      tabs,
      activeTabId: tabs[0].id,
      settings: DEFAULT_SETTINGS,
      localHostname: 'host',
      setTabs,
      setActiveTabId,
      setTabBarFocused: vi.fn(),
      setConnectTarget,
      setProfilesModalOpen,
      confirm,
    })
  );
  return { result, setTabs, setActiveTabId, setConnectTarget, setProfilesModalOpen };
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

describe('useTabActions open a profile in a tab (Connection Manager)', () => {
  const sshConfig = { id: 'p1', name: 'Prod', host: 'prod.example.com', username: 'u', authType: 'password' } as any;
  const k8sTarget = { contextName: 'ctx', namespace: 'ns', podName: 'web-1', containerName: 'app' } as any;
  const emptyTerminal = { id: 't1', type: 'terminal', title: 'Terminal 1', paneTree: { type: 'leaf', id: 'l1' } } as AppTab;
  const connectedTerminal = {
    id: 't1',
    type: 'terminal',
    title: 'other',
    paneTree: { type: 'leaf', id: 'l1', config: { id: 'x', name: 'other' } },
  } as unknown as AppTab;
  const fileManager = { id: 't1', type: 'filemanager', title: 'Files' } as AppTab;

  const applyTabs = (setTabs: ReturnType<typeof vi.fn>, prev: AppTab[]) =>
    (setTabs.mock.calls[0][0] as (p: AppTab[]) => AppTab[])(prev);

  describe('handleOpenSSHInTab', () => {
    it('connects in place when the active tab is an empty terminal, and closes the modal', () => {
      const { result, setTabs, setActiveTabId, setProfilesModalOpen, setConnectTarget } = setup([emptyTerminal]);
      act(() => result.current.handleOpenSSHInTab(sshConfig));

      const next = applyTabs(setTabs, [emptyTerminal]);
      expect(next).toHaveLength(1);
      expect(next[0]).toMatchObject({ id: 't1', title: 'Prod', paneTree: { config: sshConfig, local: false, baseHost: 'prod.example.com' } });
      expect(setActiveTabId).not.toHaveBeenCalled();
      expect(setConnectTarget).toHaveBeenCalledWith(null);
      expect(setProfilesModalOpen).toHaveBeenCalledWith(false);
    });

    it.each([
      ['a connected terminal', connectedTerminal],
      ['a file manager', fileManager],
    ])('opens a new terminal tab and selects it when the active tab is %s', (_label, active) => {
      const { result, setTabs, setActiveTabId, setProfilesModalOpen } = setup([active]);
      act(() => result.current.handleOpenSSHInTab(sshConfig));

      const next = applyTabs(setTabs, [active]);
      expect(next).toHaveLength(2);
      expect(next[0]).toBe(active);
      expect(next[1]).toMatchObject({ type: 'terminal', title: 'Prod', paneTree: { type: 'leaf', config: sshConfig } });
      expect(next[1].id).toMatch(/^term-\d+$/);
      expect(setActiveTabId).toHaveBeenCalledWith(next[1].id);
      expect(setProfilesModalOpen).toHaveBeenCalledWith(false);
    });
  });

  describe('handleOpenK8sInTab', () => {
    it('connects in place when the active tab is an empty terminal, and closes the modal', () => {
      const { result, setTabs, setActiveTabId, setProfilesModalOpen } = setup([emptyTerminal]);
      act(() => result.current.handleOpenK8sInTab(k8sTarget));

      const next = applyTabs(setTabs, [emptyTerminal]);
      expect(next).toHaveLength(1);
      expect(next[0]).toMatchObject({ id: 't1', title: 'web-1', paneTree: { k8sTarget, baseHost: 'web-1/app' } });
      expect(setActiveTabId).not.toHaveBeenCalled();
      expect(setProfilesModalOpen).toHaveBeenCalledWith(false);
    });

    it('opens a new terminal tab titled after the pod when the active tab is a file manager', () => {
      const { result, setTabs, setActiveTabId } = setup([fileManager]);
      act(() => result.current.handleOpenK8sInTab(k8sTarget));

      const next = applyTabs(setTabs, [fileManager]);
      expect(next).toHaveLength(2);
      expect(next[1]).toMatchObject({ type: 'terminal', title: 'web-1', paneTree: { type: 'leaf', k8sTarget } });
      expect(setActiveTabId).toHaveBeenCalledWith(next[1].id);
    });
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
