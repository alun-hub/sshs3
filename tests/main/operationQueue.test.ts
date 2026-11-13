import { describe, it, expect } from 'vitest';
import { OperationQueue } from '../../src/main/ca/operationQueue';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('OperationQueue', () => {
  it('runs operations one at a time, in the order they were queued', async () => {
    const queue = new OperationQueue();
    const log: string[] = [];
    let running = 0;
    let maxRunning = 0;
    const op = (name: string, ms: number) => async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      log.push(`start ${name}`);
      await delay(ms);
      log.push(`end ${name}`);
      running--;
      return name;
    };

    const results = await Promise.all([queue.run(op('a', 30)), queue.run(op('b', 5)), queue.run(op('c', 1))]);

    expect(results).toEqual(['a', 'b', 'c']);
    expect(maxRunning).toBe(1);
    expect(log).toEqual(['start a', 'end a', 'start b', 'end b', 'start c', 'end c']);
  });

  it('keeps going after an operation failed', async () => {
    const queue = new OperationQueue();
    const failed = queue.run(async () => {
      throw new Error('boom');
    });
    const next = queue.run(async () => 'still runs');

    await expect(failed).rejects.toThrow('boom');
    await expect(next).resolves.toBe('still runs');
  });

  it('cancelAll aborts the running operation and drops the queued ones, but not later ones', async () => {
    const queue = new OperationQueue('cancelled!');
    let sawAbort = false;
    const first = queue.run(
      (signal) =>
        new Promise<string>((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            sawAbort = true;
            reject(new Error('aborted inside'));
          });
        })
    );
    const queued = queue.run(async () => 'must not run');
    await delay(5);

    queue.cancelAll();
    const after = queue.run(async () => 'runs after the cancel');

    await expect(first).rejects.toThrow('aborted inside');
    await expect(queued).rejects.toThrow('cancelled!');
    await expect(after).resolves.toBe('runs after the cancel');
    expect(sawAbort).toBe(true);
  });

  it('forwards an external abort signal to the operation and refuses an already aborted one', async () => {
    const queue = new OperationQueue('cancelled!');
    const external = new AbortController();
    const running = queue.run(
      (signal) => new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('stopped')))),
      external.signal
    );
    await delay(5);
    external.abort();
    await expect(running).rejects.toThrow('stopped');

    const already = new AbortController();
    already.abort();
    await expect(queue.run(async () => 'x', already.signal)).rejects.toThrow('cancelled!');
  });

  it('runReplacing aborts a running replaceable operation and runs the new one', async () => {
    const queue = new OperationQueue('cancelled!');
    const stalled = queue.runReplacing(
      (signal) => new Promise<string>((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('stopped'))))
    );
    await delay(5);
    const retry = queue.runReplacing(async () => 'retried');
    await expect(stalled).rejects.toThrow('stopped');
    await expect(retry).resolves.toBe('retried');
  });

  it('runReplacing drops a queued replaceable operation but never a plain one', async () => {
    const queue = new OperationQueue('cancelled!');
    const order: string[] = [];
    const plain = queue.run(async () => {
      await delay(10);
      order.push('plain');
    });
    const dropped = queue.runReplacing(async () => order.push('dropped'));
    const logout = queue.run(async () => order.push('logout'));
    const newest = queue.runReplacing(async () => order.push('newest'));
    await plain;
    await expect(dropped).rejects.toThrow('cancelled!');
    await logout;
    await newest;
    expect(order).toEqual(['plain', 'logout', 'newest']);
  });

  it('runReplacing does not abort a running plain operation', async () => {
    const queue = new OperationQueue('cancelled!');
    let aborted = false;
    const plain = queue.run(async (signal) => {
      await delay(15);
      aborted = signal.aborted;
    });
    const replacing = queue.runReplacing(async () => 'ok');
    await plain;
    expect(aborted).toBe(false);
    await expect(replacing).resolves.toBe('ok');
  });
});
