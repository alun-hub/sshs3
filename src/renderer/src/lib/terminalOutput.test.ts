import { describe, it, expect } from 'vitest';
import type { Terminal } from 'xterm';
import { CommandOutputTracker } from './terminalOutput';

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
});
