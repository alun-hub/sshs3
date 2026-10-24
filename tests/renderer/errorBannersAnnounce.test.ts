import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// An error that appears after a failed action must reach screen-reader users: its element needs role="alert".
// This scans the renderer components for the conditional-error pattern the app uses,
//   {error && ( <div className="... red-..."> ...
// and fails for any such element without a role, so a new banner cannot silently skip it.

const ROOT = join(__dirname, '../../src/renderer/src/components');
const VAR = String.raw`(?:\w+\.)?[A-Za-z]*(?:[Ee]rr(?:or)?|errorMessage)\b`;
const CONDITIONAL = new RegExp(String.raw`\{\s*${VAR}(?:\s*&&\s*[!\w.]+)*\s*&&\s*\(?\s*<(div|p|span)\b`, 'g');

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? tsxFiles(full) : full.endsWith('.tsx') ? [full] : [];
  });
}

/** Source of the opening tag that starts at `from`, up to its closing `>` (skips braces and quotes). */
function openingTag(source: string, from: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let i = from; i < source.length; i++) {
    const c = source[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '>' && depth === 0) return source.slice(from, i);
  }
  return source.slice(from);
}

describe('error banners are announced', () => {
  it('every conditional red/rose error element carries a role', () => {
    const missing: string[] = [];
    for (const file of tsxFiles(ROOT)) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(CONDITIONAL)) {
        const tagStart = (match.index ?? 0) + match[0].lastIndexOf('<');
        const tag = openingTag(source, tagStart);
        if (/red-|rose-/.test(tag) && !/\brole=/.test(tag)) {
          const line = source.slice(0, tagStart).split('\n').length;
          missing.push(`${relative(ROOT, file)}:${line}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('finds the banners it is meant to guard (the scan is not silently empty)', () => {
    let found = 0;
    for (const file of tsxFiles(ROOT)) {
      for (const match of readFileSync(file, 'utf8').matchAll(CONDITIONAL)) found += match.length > 0 ? 1 : 0;
    }
    expect(found).toBeGreaterThan(30);
  });
});
