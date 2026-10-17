import { describe, it, expect } from 'vitest';
import type { Terminal } from 'xterm';
import { CommandOutputTracker, stripPrompt } from './terminalOutput';

interface FakeLine {
  text: string;
  wrapped?: boolean;
}

/** Minimal xterm stand-in: a flat list of buffer lines and a cursor on the last one. */
function fakeTerm(lines: FakeLine[], opts: { type?: 'normal' | 'alternate' } = {}) {
  const buffer = {
    type: opts.type ?? 'normal',
    baseY: 0,
    get cursorY() {
      return lines.length - 1;
    },
    getLine: (i: number) =>
      lines[i] && { isWrapped: Boolean(lines[i].wrapped), translateToString: () => lines[i].text },
  };
  let osc: ((data: string) => boolean) | undefined;
  const term = {
    buffer: { active: buffer },
    registerMarker: () => ({ line: lines.length - 1, isDisposed: false, dispose() {} }),
    parser: {
      registerOscHandler: (_id: number, cb: (data: string) => boolean) => {
        osc = cb;
        return { dispose() {} };
      },
    },
  };
  return { term: term as unknown as Terminal, lines, osc: (data: string) => osc?.(data) };
}

describe('CommandOutputTracker', () => {
  it('returns the output between the last command line and the current prompt', () => {
    const { term, lines } = fakeTerm([{ text: '$ ls' }]);
    const t = new CommandOutputTracker(term);
    t.recordEnter();
    lines.push({ text: 'a.txt' }, { text: 'b.txt' }, { text: '' }, { text: '$ ' });
    expect(t.lastOutput()).toBe('a.txt\nb.txt');
  });

  it('skips commands without output and rejoins wrapped lines', () => {
    const { term, lines } = fakeTerm([{ text: '$ echo long' }]);
    const t = new CommandOutputTracker(term);
    t.recordEnter();
    lines.push({ text: 'aaaa' }, { text: 'bbbb', wrapped: true }, { text: '$ ' });
    t.recordEnter(); // Enter on an empty prompt
    lines.push({ text: '$ ' });
    expect(t.lastOutput()).toBe('aaaabbbb');
  });

  it('uses OSC 133 marks when the shell sends them, ignoring multi-line prompt headers', () => {
    const f = fakeTerm([{ text: '┌ user@host' }, { text: '└> ls' }]);
    const t = new CommandOutputTracker(f.term);
    t.recordEnter();
    f.lines.push({ text: '' }); // the cursor moves to a fresh row before the output starts
    f.osc('C');
    f.lines[f.lines.length - 1].text = 'a.txt';
    f.lines.push({ text: 'b.txt' }, { text: '' });
    f.osc('D;0');
    f.lines.pop(); // the prompt reuses the row the cursor was on
    f.lines.push({ text: '┌ user@host' }, { text: '└> ' });
    expect(t.lastOutput()).toBe('a.txt\nb.txt');
  });

  it('returns null with no commands or in the alternate screen', () => {
    expect(new CommandOutputTracker(fakeTerm([{ text: '$ ' }]).term).lastOutput()).toBeNull();
    const alt = fakeTerm([{ text: 'x' }], { type: 'alternate' });
    const t = new CommandOutputTracker(alt.term);
    t.recordEnter();
    expect(t.lastOutput()).toBeNull();
  });

  it('extracts command and output metadata with getCleanOutput and lastCommand', () => {
    const f = fakeTerm([{ text: 'alun@host:~$ cat /etc/os-release' }]);
    const t = new CommandOutputTracker(f.term);
    t.recordEnter();
    f.lines.push({ text: 'NAME="Fedora Linux"' }, { text: 'VERSION="40"' }, { text: 'alun@host:~$ ' });

    expect(t.lastCommand()).toBe('cat /etc/os-release');
    const clean = t.getCleanOutput();
    expect(clean).toEqual({
      text: 'NAME="Fedora Linux"\nVERSION="40"',
      lineCount: 2,
      charCount: 32,
    });
  });

  it('tracks commands using OSC 133;B and OSC 133;C', () => {
    const f = fakeTerm([{ text: 'user@box:~$ ' }]);
    const t = new CommandOutputTracker(f.term);
    f.osc('B');
    f.lines[0].text = 'user@box:~$ uptime';
    f.osc('C');
    f.lines.push({ text: 'up 14 days' }, { text: '' });
    f.osc('D;0');
    f.lines.pop();
    f.lines.push({ text: 'user@box:~$ ' });

    expect(t.lastCommand()).toBe('uptime');
    expect(t.lastOutput()).toBe('up 14 days');
  });

  it('strips diverse prompt prefixes correctly without mutilating commands', () => {
    expect(stripPrompt('$ ls -la')).toBe('ls -la');
    expect(stripPrompt('user@host:~$ ping 1.1.1.1')).toBe('ping 1.1.1.1');
    expect(stripPrompt('[root@srv /etc]# dnf update')).toBe('dnf update');
    expect(stripPrompt('➜ git:(main) git status')).toBe('git status');
    expect(stripPrompt('❯ cargo build')).toBe('cargo build');
    expect(stripPrompt('echo $HOME')).toBe('echo $HOME');
  });

  it('copies clean output to clipboard via copyCleanOutputToClipboard helper', async () => {
    const { copyCleanOutputToClipboard } = await import('./terminalOutput');
    const f = fakeTerm([{ text: '$ echo test' }]);
    const t = new CommandOutputTracker(f.term);
    t.recordEnter();
    f.lines.push({ text: 'output line 1' }, { text: '$ ' });

    let written = '';
    const orig = navigator.clipboard;
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async (s: string) => { written = s; } },
      configurable: true,
    });

    const res = await copyCleanOutputToClipboard(t);
    expect(res?.text).toBe('output line 1');
    expect(written).toBe('output line 1');

    Object.defineProperty(navigator, 'clipboard', {
      value: orig,
      configurable: true,
    });
  });
});
