import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { locateTools } from '../../../src/main/aws/AwsSsmToolchain';

afterEach(() => vi.useRealTimers());

describe('locateTools result reuse', () => {
  it('reuses a result for a moment (no repeated PATH walk), then looks again so an install is noticed', () => {
    vi.useFakeTimers();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-cache-'));
    // The 'linux' platform joins with '/', so build the expected path the same way (also correct when run on Windows).
    const aws = path.posix.join(dir, 'aws');
    fs.writeFileSync(aws, '#!/bin/sh\n', { mode: 0o755 });
    const env = { PATH: dir } as NodeJS.ProcessEnv;
    expect(locateTools('linux', env, dir).aws).toBe(aws);
    fs.rmSync(aws);
    expect(locateTools('linux', env, dir).aws).toBe(aws); // still the cached answer
    vi.advanceTimersByTime(2500);
    expect(locateTools('linux', env, dir).aws).not.toBe(aws); // looked again (a system-wide aws may still be found)
    // A different PATH is never answered from the cache.
    vi.advanceTimersByTime(2500);
    fs.writeFileSync(aws, '#!/bin/sh\n', { mode: 0o755 });
    expect(locateTools('linux', env, dir).aws).toBe(aws);
    fs.rmSync(aws);
    expect(locateTools('linux', { PATH: '/nonexistent' } as NodeJS.ProcessEnv, dir).aws).not.toBe(aws);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
