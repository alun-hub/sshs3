import { describe, it, expect, vi } from 'vitest';
import { createUploadCoalescer } from '../../src/main/editor/uploadCoalescer';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('createUploadCoalescer', () => {
  it('turns a burst of changes into one upload after the quiet period', async () => {
    let uploads = 0;
    const c = createUploadCoalescer(async () => void uploads++, 20);
    c.trigger();
    c.trigger();
    c.trigger();
    expect(uploads).toBe(0);
    await sleep(60);
    expect(uploads).toBe(1);
    c.dispose();
  });

  it('never runs two uploads at once, and folds changes made during one into a single follow-up', async () => {
    // Driven by hand instead of by sleeps: timer granularity differs per platform (about 15 ms on Windows).
    let running = 0;
    let maxRunning = 0;
    let uploads = 0;
    const releases: Array<() => void> = [];
    const c = createUploadCoalescer(
      () =>
        new Promise<void>((resolve) => {
          uploads++;
          running++;
          maxRunning = Math.max(maxRunning, running);
          releases.push(() => {
            running--;
            resolve();
          });
        }),
      10
    );

    c.trigger();
    await vi.waitFor(() => expect(uploads).toBe(1)); // the first upload is now running and stays running
    c.trigger();
    c.trigger();
    c.trigger();
    await sleep(60); // all three have long passed the debounce; none of them may start a second upload
    expect(uploads).toBe(1);

    releases[0]();
    await vi.waitFor(() => expect(uploads).toBe(2)); // one follow-up for everything that changed meanwhile
    releases[1]();
    await c.flush();

    expect(maxRunning).toBe(1);
    expect(uploads).toBe(2);
    c.dispose();
  });

  it('flush uploads a change that is still waiting out the quiet period, and waits for it', async () => {
    let done = false;
    const c = createUploadCoalescer(async () => {
      await sleep(20);
      done = true;
    }, 10_000);
    c.trigger();
    await c.flush();
    expect(done).toBe(true);
    c.dispose();
  });

  it('flush does nothing when nothing changed', async () => {
    let uploads = 0;
    const c = createUploadCoalescer(async () => void uploads++, 10);
    await c.flush();
    expect(uploads).toBe(0);
    c.dispose();
  });

  it('dispose drops a pending upload and ignores later changes', async () => {
    let uploads = 0;
    const c = createUploadCoalescer(async () => void uploads++, 20);
    c.trigger();
    c.dispose();
    c.trigger();
    await sleep(60);
    expect(uploads).toBe(0);
  });

  it('keeps going after an upload that threw', async () => {
    let calls = 0;
    const c = createUploadCoalescer(async () => {
      calls++;
      if (calls === 1) throw new Error('network down');
    }, 10);
    c.trigger();
    await sleep(40);
    c.trigger();
    await c.flush();
    expect(calls).toBe(2);
    c.dispose();
  });
});
