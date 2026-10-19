import { describe, expect, it } from 'vitest';
import { allowPreview, hoverModifierSatisfied, isRelativePath, needsExistenceCheck } from './pathPreviewGate';

const slashed = { bareToken: false, relative: false, cwdKnown: true } as const;

describe('allowPreview', () => {
  it('drops a path that is known not to exist', () => {
    expect(allowPreview(slashed, 'missing')).toBe(false);
    expect(allowPreview({ ...slashed, relative: true }, 'missing')).toBe(false);
  });

  it('keeps a path that exists, or whose lookup was not possible', () => {
    expect(allowPreview(slashed, 'exists')).toBe(true);
    expect(allowPreview(slashed, 'unknown')).toBe(true);
  });

  it('requires bare words to exist', () => {
    const bare = { bareToken: true, relative: true, cwdKnown: false };
    expect(allowPreview(bare, 'exists')).toBe(true);
    expect(allowPreview(bare, 'missing')).toBe(false);
    expect(allowPreview(bare, 'unknown')).toBe(false);
  });

  it('does not judge a relative path while the working directory is only assumed', () => {
    const guess = { bareToken: false, relative: true, cwdKnown: false };
    expect(needsExistenceCheck(guess)).toBe(false);
    expect(allowPreview(guess, 'missing')).toBe(true);
  });

  it('still checks absolute paths when the working directory is unknown', () => {
    expect(needsExistenceCheck({ bareToken: false, relative: false, cwdKnown: false })).toBe(true);
  });
});

describe('isRelativePath', () => {
  it.each(['src/a.ts', './a', '../a', 'README.md', 'a b/c'])('treats %s as relative', (p) => {
    expect(isRelativePath(p)).toBe(true);
  });

  it.each(['/etc/hosts', '~/x', '~', 'C:\\Users\\me', 'C:/x', '\\\\srv\\share\\f', "'/etc/hosts'"])(
    'treats %s as anchored',
    (p) => {
      expect(isRelativePath(p)).toBe(false);
    }
  );
});

describe('hoverModifierSatisfied', () => {
  it('always passes in hover mode', () => {
    expect(hoverModifierSatisfied('hover', { ctrlKey: false, metaKey: false })).toBe(true);
  });

  it('needs Ctrl or Cmd in ctrl mode', () => {
    expect(hoverModifierSatisfied('ctrl', { ctrlKey: false, metaKey: false })).toBe(false);
    expect(hoverModifierSatisfied('ctrl', { ctrlKey: true, metaKey: false })).toBe(true);
    expect(hoverModifierSatisfied('ctrl', { ctrlKey: false, metaKey: true })).toBe(true);
  });
});
