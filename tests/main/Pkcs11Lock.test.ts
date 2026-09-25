import { describe, it, expect } from 'vitest';
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
});
