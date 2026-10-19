// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Terminal } from 'xterm';
import type { CommandOutputTracker } from '../../src/renderer/src/lib/terminalOutput';
import { useSudoRetry } from '../../src/renderer/src/lib/useSudoRetry';

function setup(opts: { enabled?: boolean; cursorLine?: string; command?: string; output?: string; exitCode?: number } = {}) {
  const cursorLine = { text: opts.cursorLine ?? 'user@host:~$ ' };
  const term = {
    buffer: {
      active: { type: 'normal', baseY: 0, cursorY: 0, getLine: () => ({ translateToString: () => cursorLine.text }) },
    },
  } as unknown as Terminal;
  const tracker = {
    lastCommand: () => opts.command ?? 'cat /etc/shadow',
    lastOutput: () => opts.output ?? 'cat: /etc/shadow: Permission denied',
    lastExitCode: () => opts.exitCode,
  } as unknown as CommandOutputTracker;
  const run = vi.fn();
  const view = renderHook(() =>
    useSudoRetry({ enabled: opts.enabled ?? true, termRef: { current: term }, trackerRef: { current: tracker }, run })
  );
  return { ...view, run, cursorLine };
}

const key = (k: string) => new KeyboardEvent('keydown', { key: k });

describe('useSudoRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-19T10:00:00'));
  });
  afterEach(() => vi.useRealTimers());

  const fail = (r: ReturnType<typeof setup>) => {
    act(() => {
      r.result.current.notifyEnter();
      r.result.current.notifyOutput();
      vi.advanceTimersByTime(300);
    });
  };

  it('offers sudo once output goes quiet at a prompt', () => {
    const r = setup();
    fail(r);
    expect(r.result.current.suggestion).toEqual({ sudoCommand: 'sudo cat /etc/shadow' });
  });

  it('stays quiet when the command is not at a prompt yet, and shows once it is', () => {
    const r = setup({ cursorLine: 'Password: ' });
    fail(r);
    expect(r.result.current.suggestion).toBeNull();
    r.cursorLine.text = 'user@host:~$ ';
    act(() => {
      r.result.current.notifyOutput();
      vi.advanceTimersByTime(300);
    });
    expect(r.result.current.suggestion).not.toBeNull();
  });

  it('does nothing when disabled, at a root prompt, or for an unrelated failure', () => {
    for (const r of [
      setup({ enabled: false }),
      setup({ cursorLine: '[root@host ~]# ' }),
      setup({ output: 'ls: cannot access x: No such file or directory' }),
    ]) {
      fail(r);
      expect(r.result.current.suggestion).toBeNull();
    }
  });

  it('accepts on Enter after the guard time and runs the command', () => {
    const r = setup();
    fail(r);
    act(() => vi.advanceTimersByTime(500));
    let consumed = false;
    act(() => {
      consumed = r.result.current.handleKey(key('Enter'));
    });
    expect(consumed).toBe(true);
    expect(r.run).toHaveBeenCalledWith('sudo cat /etc/shadow');
    expect(r.result.current.suggestion).toBeNull();
  });

  it('ignores an Enter that arrives inside the guard time but still swallows it', () => {
    const r = setup();
    fail(r);
    let consumed = false;
    act(() => {
      consumed = r.result.current.handleKey(key('Enter'));
    });
    expect(consumed).toBe(true);
    expect(r.run).not.toHaveBeenCalled();
    expect(r.result.current.suggestion).not.toBeNull();
  });

  it('dismisses on Escape or other input without running', () => {
    const r = setup();
    fail(r);
    act(() => {
      r.result.current.handleKey(key('Escape'));
    });
    expect(r.result.current.suggestion).toBeNull();

    fail(r);
    expect(r.result.current.suggestion).not.toBeNull();
    act(() => r.result.current.notifyInput());
    expect(r.result.current.suggestion).toBeNull();
    expect(r.run).not.toHaveBeenCalled();
  });

  it('does not consume keys while nothing is offered', () => {
    const r = setup();
    expect(r.result.current.handleKey(key('Enter'))).toBe(false);
    expect(r.result.current.handleKey(key('Escape'))).toBe(false);
  });
});
