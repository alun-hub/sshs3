import { describe, it, expect, vi } from 'vitest';
import { WindowManager, type ManagedWindow } from './WindowManager';

function fakeWindow(id: number): ManagedWindow & { destroyed: boolean; send: ReturnType<typeof vi.fn>; frame: object } {
  const send = vi.fn();
  const frame = {};
  const win = {
    destroyed: false,
    send,
    frame,
    webContents: {
      id,
      mainFrame: frame,
      isDestroyed: () => win.destroyed,
      send,
    },
    isDestroyed: () => win.destroyed,
  };
  return win;
}

describe('WindowManager', () => {
  it('routes a session event only to the owning window', () => {
    const wm = new WindowManager();
    const a = fakeWindow(1);
    const b = fakeWindow(2);
    wm.register(a);
    wm.register(b);
    wm.assign('s1', 1);

    expect(wm.sendToSession('s1', 'pty:data', { data: 'x' })).toBe(true);
    expect(a.send).toHaveBeenCalledWith('pty:data', { data: 'x' });
    expect(b.send).not.toHaveBeenCalled();
  });

  it('falls back to the focused window for a session without an owner, and reports no target', () => {
    const wm = new WindowManager();
    const a = fakeWindow(1);
    const b = fakeWindow(2);
    wm.register(a);
    wm.register(b);
    wm.setFocused(1);
    wm.sendToSession('unknown', 'ch');
    expect(a.send).toHaveBeenCalledTimes(1);

    expect(new WindowManager().sendToSession('s', 'ch')).toBe(false);
  });

  it('moves ownership when a tab is transferred', () => {
    const wm = new WindowManager();
    const a = fakeWindow(1);
    const b = fakeWindow(2);
    wm.register(a);
    wm.register(b);
    wm.assign('s1', 1);
    wm.assign('s2', 1);
    wm.transfer(['s1'], 2);

    expect(wm.ownerOf('s1')).toBe(2);
    expect(wm.sessionsOf(1)).toEqual(['s2']);
    wm.sendToSession('s1', 'ch');
    expect(b.send).toHaveBeenCalledTimes(1);
  });

  it('ignores assignment to an unknown window', () => {
    const wm = new WindowManager();
    wm.assign('s1', 99);
    expect(wm.ownerOf('s1')).toBeUndefined();
  });

  it('releases the sessions of a closed window and moves focus to a remaining one', () => {
    const wm = new WindowManager();
    const a = fakeWindow(1);
    const b = fakeWindow(2);
    wm.register(a);
    wm.register(b);
    wm.assign('s1', 2);

    expect(wm.unregister(2)).toEqual(['s1']);
    expect(wm.ownerOf('s1')).toBeUndefined();
    expect(wm.focused()).toBe(a);
  });

  it('skips destroyed windows for prompts and broadcasts', () => {
    const wm = new WindowManager();
    const a = fakeWindow(1);
    const b = fakeWindow(2);
    wm.register(a);
    wm.register(b);
    b.destroyed = true;

    expect(wm.focused()).toBe(a);
    wm.broadcast('settings:changed', 1);
    expect(a.send).toHaveBeenCalledWith('settings:changed', 1);
    expect(b.send).not.toHaveBeenCalled();
  });

  it('only trusts the top-level frame of a registered, live window', () => {
    const wm = new WindowManager();
    const a = fakeWindow(1);
    wm.register(a);

    expect(wm.isTrustedFrame(a.frame)).toBe(true);
    expect(wm.isTrustedFrame({})).toBe(false);
    expect(wm.isTrustedFrame(undefined)).toBe(false);
    a.destroyed = true;
    expect(wm.isTrustedFrame(a.frame)).toBe(false);
  });

  it('resolves the window id of a sender only for registered windows', () => {
    const wm = new WindowManager();
    wm.register(fakeWindow(7));
    expect(wm.windowIdOfSender({ id: 7 })).toBe(7);
    expect(wm.windowIdOfSender({ id: 8 })).toBeUndefined();
    expect(wm.windowIdOfSender(null)).toBeUndefined();
  });
});
