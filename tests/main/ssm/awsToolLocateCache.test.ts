import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { clearToolLocateCache, locateTools } from '../../../src/main/aws/AwsSsmToolchain';

afterEach(() => vi.useRealTimers());

// Runs with the real platform: PATH is split on ':' or ';' and the file is named aws or aws.exe accordingly.
const platform = process.platform;
const name = platform === 'win32' ? 'aws.exe' : 'aws';
const join = platform === 'win32' ? path.win32.join : path.posix.join;

describe('locateTools result reuse', () => {
  it('reuses a result for a moment (no repeated PATH walk), then looks again so an install is noticed', () => {
    vi.useFakeTimers();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-cache-'));
    const aws = join(dir, name);
    const install = () => fs.writeFileSync(aws, '#!/bin/sh\n', { mode: 0o755 });
    const env = { PATH: dir } as NodeJS.ProcessEnv;
    install();
    expect(locateTools(platform, env, dir).aws).toBe(aws);
    fs.rmSync(aws);
    expect(locateTools(platform, env, dir).aws).toBe(aws); // still the cached answer
    vi.advanceTimersByTime(2500);
    expect(locateTools(platform, env, dir).aws).not.toBe(aws); // looked again (a system-wide aws may still be found)
    // A different PATH is never answered from the cache.
    vi.advanceTimersByTime(2500);
    install();
    expect(locateTools(platform, env, dir).aws).toBe(aws);
    fs.rmSync(aws);
    expect(locateTools(platform, { PATH: join(dir, 'nonexistent') } as NodeJS.ProcessEnv, dir).aws).not.toBe(aws);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('an explicit clear (the "Check again" path) looks at the file system again at once', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-clear-'));
    const aws = join(dir, name);
    const env = { PATH: dir } as NodeJS.ProcessEnv;
    clearToolLocateCache();
    expect(locateTools(platform, env, dir).aws).not.toBe(aws); // nothing installed yet (a system-wide aws may be found)
    fs.writeFileSync(aws, '#!/bin/sh\n', { mode: 0o755 });
    expect(locateTools(platform, env, dir).aws).not.toBe(aws); // still the reused answer
    clearToolLocateCache();
    expect(locateTools(platform, env, dir).aws).toBe(aws);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
