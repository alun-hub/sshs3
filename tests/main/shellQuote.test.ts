import { describe, it, expect } from 'vitest';
import { quoteShellArg } from '../../src/main/search/shellQuote';

describe('quoteShellArg', () => {
  it('wraps plain string in single quotes', () => {
    expect(quoteShellArg('hello')).toBe("'hello'");
    expect(quoteShellArg('path/to/file.txt')).toBe("'path/to/file.txt'");
  });

  it('escapes embedded single quotes', () => {
    expect(quoteShellArg("foo'bar")).toBe("'foo'\\''bar'");
    expect(quoteShellArg("don't stop")).toBe("'don'\\''t stop'");
  });

  it('strips null bytes', () => {
    expect(quoteShellArg('hello\0world')).toBe("'helloworld'");
    expect(quoteShellArg('command\0; rm -rf /')).toBe("'command; rm -rf /'");
  });
});
