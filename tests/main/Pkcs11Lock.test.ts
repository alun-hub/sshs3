import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withPkcs11Lock } from '../../src/main/smartcard/Pkcs11Lock';

describe('Pkcs11Lock', () => {
  it('never overlaps two concurrent operations', async () => {
    let active = 0;
    let maxActive = 0;
    const order: number[] = [];

    const run = (id: number) =>
      withPkcs11Lock(async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 10));
        order.push(id);
        active--;
      });

    await Promise.all([run(1), run(2), run(3)]);

    expect(maxActive).toBe(1);
    expect(order).toEqual([1, 2, 3]);
  });

  it('keeps queuing subsequent work after an earlier operation rejects', async () => {
    let active = 0;
    let maxActive = 0;

    const failing = withPkcs11Lock(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active--;
      throw new Error('boom');
    });

    const succeeding = withPkcs11Lock(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active--;
      return 'ok';
    });

    await expect(failing).rejects.toThrow('boom');
    await expect(succeeding).resolves.toBe('ok');
    expect(maxActive).toBe(1);
  });

  // LOW finding (code review): every current caller bounds its own
  // execFile/worker with a timeout, but the queue itself previously had no
  // ceiling — a hypothetical future caller without one could wedge every
  // other PKCS#11 operation in the app forever. The built-in watchdog
  // ensures the queue always eventually moves on regardless.
  describe('watchdog', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('releases the queue for the next caller if an operation never resolves', async () => {
      const stuck = withPkcs11Lock(() => new Promise<void>(() => {})); // never settles
      const stuckExpectation = expect(stuck).rejects.toThrow(/timed out/i);

      const next = withPkcs11Lock(async () => 'unblocked');

      await vi.advanceTimersByTimeAsync(180_000);

      await stuckExpectation;
      await expect(next).resolves.toBe('unblocked');
    });

    it('does not fire the watchdog for an operation that resolves well within the timeout', async () => {
      const result = withPkcs11Lock(
        () => new Promise((resolve) => setTimeout(() => resolve('done'), 1000))
      );

      await vi.advanceTimersByTimeAsync(1000);

      await expect(result).resolves.toBe('done');
    });
  });
});
