// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { isCopyShortcut, sameRange, selectedTextWithin } from './selectionCopy';

const key = (o: Partial<KeyboardEvent>) =>
  ({ key: 'C', ctrlKey: true, metaKey: false, shiftKey: true, altKey: false, ...o }) as KeyboardEvent;

describe('isCopyShortcut', () => {
  it('matches Ctrl+Shift+C and Cmd+Shift+C', () => {
    expect(isCopyShortcut(key({}))).toBe(true);
    expect(isCopyShortcut(key({ ctrlKey: false, metaKey: true }))).toBe(true);
  });
  it('rejects plain Ctrl+C, Alt combos and other keys', () => {
    expect(isCopyShortcut(key({ shiftKey: false }))).toBe(false);
    expect(isCopyShortcut(key({ altKey: true }))).toBe(false);
    expect(isCopyShortcut(key({ key: 'V' }))).toBe(false);
  });
});

describe('selectedTextWithin', () => {
  it('returns the selection only when it is inside the container', () => {
    const inside = document.createElement('div');
    inside.textContent = 'hello world';
    const outside = document.createElement('div');
    outside.textContent = 'elsewhere';
    document.body.append(inside, outside);
    const sel = window.getSelection()!;
    sel.selectAllChildren(inside);
    expect(selectedTextWithin(inside, sel)).toBe('hello world');
    expect(selectedTextWithin(outside, sel)).toBe('');
    sel.removeAllRanges();
    expect(selectedTextWithin(inside, sel)).toBe('');
    expect(selectedTextWithin(null, sel)).toBe('');
  });

  describe('a selection that reaches outside the container', () => {
    const setup = () => {
      document.body.innerHTML = '';
      const container = document.createElement('div');
      container.innerHTML = '<p>first paragraph</p><p>second paragraph</p>';
      const before = document.createElement('div');
      before.textContent = 'before the preview';
      const after = document.createElement('div');
      after.textContent = 'after the preview';
      document.body.append(before, container, after);
      const sel = window.getSelection()!;
      return { container, before, after, sel };
    };

    it('keeps the part inside when the drag ends outside (over another pane, below the text)', () => {
      const { container, after, sel } = setup();
      const range = document.createRange();
      range.setStart(container.firstChild!.firstChild!, 6); // "paragraph" of the first paragraph
      range.setEnd(after.firstChild!, 5);
      sel.removeAllRanges();
      sel.addRange(range);

      expect(selectedTextWithin(container, sel)).toBe('paragraph\nsecond paragraph');
    });

    it('keeps the part inside when the drag starts outside', () => {
      const { container, before, sel } = setup();
      const range = document.createRange();
      range.setStart(before.firstChild!, 7);
      range.setEnd(container.lastChild!.firstChild!, 6); // "second" of the second paragraph
      sel.removeAllRanges();
      sel.addRange(range);

      expect(selectedTextWithin(container, sel)).toBe('first paragraph\nsecond');
    });

    it('keeps all of the container when the selection covers it and more', () => {
      const { container, before, after, sel } = setup();
      const range = document.createRange();
      range.setStart(before.firstChild!, 0);
      range.setEnd(after.firstChild!, 5);
      sel.removeAllRanges();
      sel.addRange(range);

      expect(selectedTextWithin(container, sel)).toBe('first paragraph\nsecond paragraph');
    });

    it('is empty for a selection that lies wholly outside', () => {
      const { container, before, sel } = setup();
      sel.selectAllChildren(before);
      expect(selectedTextWithin(container, sel)).toBe('');
    });

    it('is empty when only the edge of the container is touched', () => {
      const { container, after, sel } = setup();
      const range = document.createRange();
      range.setStart(container, container.childNodes.length); // right after the last paragraph
      range.setEnd(after.firstChild!, 5);
      sel.removeAllRanges();
      sel.addRange(range);

      expect(selectedTextWithin(container, sel)).toBe('');
    });

    it('keeps the line breaks between blocks and lists when the selection is wholly inside', () => {
      const { container, sel } = setup();
      sel.selectAllChildren(container);
      expect(selectedTextWithin(container, sel)).toContain('first paragraph');
      expect(selectedTextWithin(container, sel)).toContain('second paragraph');
    });
  });
});

describe('sameRange', () => {
  const doc = () => {
    document.body.innerHTML = '<p>one</p><p>two</p>';
    return Array.from(document.querySelectorAll('p'));
  };
  const over = (node: Node) => {
    const r = document.createRange();
    r.selectNodeContents(node);
    return r;
  };

  it('is true for the same span, even from a copy of the range', () => {
    const [one] = doc();
    expect(sameRange(over(one), over(one))).toBe(true);
    expect(sameRange(over(one), over(one).cloneRange())).toBe(true);
  });

  it('is false for another place with the same text, or a different length', () => {
    const [one, two] = doc();
    expect(sameRange(over(one), over(two))).toBe(false);
    const shorter = over(one);
    shorter.setEnd(one.firstChild!, 2);
    expect(sameRange(over(one), shorter)).toBe(false);
    const later = over(one);
    later.setStart(one.firstChild!, 1);
    expect(sameRange(over(one), later)).toBe(false);
  });
});
