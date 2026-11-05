import { describe, it, expect } from 'vitest';
import { WriteQueue } from '../../src/main/storage/writeQueue';

/** A promise the test resolves by hand, so ordering never depends on real timers. */
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('WriteQueue', () => {
  it('runs mutations strictly one after another, in the order they were queued', async () => {
    const queue = new WriteQueue();
    const events: string[] = [];
    const gate = deferred();

    const first = queue.enqueue(async () => {
      events.push('first:start');
      await gate.promise;
      events.push('first:end');
    });
    const second = queue.enqueue(async () => {
      events.push('second:start');
    });

    await Promise.resolve();
    expect(events).toEqual(['first:start']);

    gate.resolve();
    await Promise.all([first, second]);
    expect(events).toEqual(['first:start', 'first:end', 'second:start']);
  });

  it('hands each caller its own result', async () => {
    const queue = new WriteQueue();
    const [a, b] = await Promise.all([queue.enqueue(async () => 1), queue.enqueue(async () => 'two')]);
    expect(a).toBe(1);
    expect(b).toBe('two');
  });

  it('rejects only the failing caller and keeps accepting work', async () => {
    const queue = new WriteQueue();
    const failing = queue.enqueue(async () => {
      throw new Error('boom');
    });
    const following = queue.enqueue(async () => 'still runs');

    await expect(failing).rejects.toThrow('boom');
    await expect(following).resolves.toBe('still runs');
    await expect(queue.enqueue(async () => 'and later too')).resolves.toBe('and later too');
  });

  it('idle() waits for everything queued so far', async () => {
    const queue = new WriteQueue();
    const gate = deferred();
    let done = false;
    void queue.enqueue(async () => {
      await gate.promise;
      done = true;
    });

    let idleResolved = false;
    const idle = queue.idle().then(() => {
      idleResolved = true;
    });
    await Promise.resolve();
    expect(idleResolved).toBe(false);

    gate.resolve();
    await idle;
    expect(done).toBe(true);
  });

  it('idle() resolves, not rejects, after a failed mutation', async () => {
    const queue = new WriteQueue();
    const failing = queue.enqueue(async () => {
      throw new Error('boom');
    });
    failing.catch(() => {});
    await expect(queue.idle()).resolves.toBeUndefined();
  });

  it('keeps separate queues independent of each other', async () => {
    const a = new WriteQueue();
    const b = new WriteQueue();
    const gate = deferred();
    void a.enqueue(() => gate.promise);

    await expect(b.enqueue(async () => 'not blocked by a')).resolves.toBe('not blocked by a');
    gate.resolve();
    await a.idle();
  });
});
