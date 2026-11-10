import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { ListenerSet, type EmitterLike } from '../../src/main/ipc/listenerSet';

/** An emitter that also records every on()/off() in a shared, ordered log. */
class LoggedEmitter extends EventEmitter {
  constructor(
    private readonly name: string,
    private readonly log: string[]
  ) {
    super();
  }
  override on(event: string | symbol, listener: (...args: any[]) => void): this {
    this.log.push(`on:${this.name}:${String(event)}`);
    return super.on(event, listener);
  }
  override off(event: string | symbol, listener: (...args: any[]) => void): this {
    this.log.push(`off:${this.name}:${String(event)}`);
    return super.off(event, listener);
  }
}

describe('ListenerSet', () => {
  describe('on()', () => {
    it('subscribes the listener, so the emitter reaches it', () => {
      const emitter = new EventEmitter();
      const set = new ListenerSet();
      const listener = vi.fn();

      set.on(emitter, 'data', listener);
      emitter.emit('data', 'a', 2);

      expect(listener).toHaveBeenCalledWith('a', 2);
    });

    it('counts what is attached', () => {
      const set = new ListenerSet();
      const emitter = new EventEmitter();
      expect(set.size).toBe(0);
      set.on(emitter, 'a', () => {});
      set.on(emitter, 'b', () => {});
      set.subscribe(emitter, () => {});
      expect(set.size).toBe(3);
    });
  });

  describe('detach(owner)', () => {
    it('stops the listener from being called', () => {
      const emitter = new EventEmitter();
      const set = new ListenerSet();
      const listener = vi.fn();
      set.on(emitter, 'data', listener);

      set.detach(emitter);
      emitter.emit('data', 'late');

      expect(listener).not.toHaveBeenCalled();
      expect(emitter.listenerCount('data')).toBe(0);
    });

    it('removes only that owner\'s listeners: other sources stay attached', () => {
      const a = new EventEmitter();
      const b = new EventEmitter();
      const set = new ListenerSet();
      const onA = vi.fn();
      const onB = vi.fn();
      set.on(a, 'data', onA);
      set.on(b, 'data', onB);

      set.detach(a);
      a.emit('data');
      b.emit('data');

      expect(onA).not.toHaveBeenCalled();
      expect(onB).toHaveBeenCalledTimes(1);
      expect(set.size).toBe(1);
    });

    it('leaves listeners that someone else attached to the same emitter alone', () => {
      const emitter = new EventEmitter();
      const set = new ListenerSet();
      const foreign = vi.fn();
      emitter.on('data', foreign);
      set.on(emitter, 'data', vi.fn());

      set.detach(emitter);
      emitter.emit('data');

      expect(foreign).toHaveBeenCalledTimes(1);
    });

    it('removes one function registered for several events from each of them', () => {
      const emitter = new EventEmitter();
      const set = new ListenerSet();
      const listener = vi.fn();
      set.on(emitter, 'a', listener);
      set.on(emitter, 'b', listener);

      set.detach(emitter);
      emitter.emit('a');
      emitter.emit('b');

      expect(listener).not.toHaveBeenCalled();
    });

    it('removes in the order the listeners were attached', () => {
      const log: string[] = [];
      const emitter = new LoggedEmitter('pty', log);
      const set = new ListenerSet();
      set.on(emitter, 'data', () => {});
      set.on(emitter, 'exit', () => {});
      set.on(emitter, 'askpass', () => {});
      log.length = 0;

      set.detach(emitter);

      expect(log).toEqual(['off:pty:data', 'off:pty:exit', 'off:pty:askpass']);
    });

    it('lets the caller detach one source at a time, in the order its shutdown needs', () => {
      const log: string[] = [];
      const first = new LoggedEmitter('first', log);
      const second = new LoggedEmitter('second', log);
      const set = new ListenerSet();
      set.on(second, 'x', () => {});
      set.on(first, 'x', () => {});
      log.length = 0;

      set.detach(first);
      log.push('stop first');
      set.detach(second);

      expect(log).toEqual(['off:first:x', 'stop first', 'off:second:x']);
    });

    it('does nothing for an owner that never attached anything', () => {
      const set = new ListenerSet();
      expect(() => set.detach(new EventEmitter())).not.toThrow();
    });

    it('is safe to call twice: the second call does not remove anything again', () => {
      const log: string[] = [];
      const emitter = new LoggedEmitter('e', log);
      const set = new ListenerSet();
      set.on(emitter, 'data', () => {});
      log.length = 0;

      set.detach(emitter);
      set.detach(emitter);

      expect(log).toEqual(['off:e:data']);
    });

    it('does not retry a removal that threw (it was already forgotten)', () => {
      const owner = {};
      const remove = vi.fn(() => {
        throw new Error('boom');
      });
      const set = new ListenerSet();
      set.subscribe(owner, remove);

      expect(() => set.detach(owner)).toThrow('boom');
      expect(() => set.detach(owner)).not.toThrow();
      expect(remove).toHaveBeenCalledTimes(1);
    });
  });

  describe('a removal that throws', () => {
    const throwing = (message: string) => () => {
      throw new Error(message);
    };

    it('does not stop the other removals of that owner, and reports the error to onError', () => {
      const onError = vi.fn();
      const owner = {};
      const after = vi.fn();
      const set = new ListenerSet(onError);
      set.subscribe(owner, throwing('first'));
      set.subscribe(owner, after);

      expect(() => set.detach(owner)).not.toThrow();

      expect(after).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledTimes(1);
      expect((onError.mock.calls[0][0] as Error).message).toBe('first');
    });

    it('is reported once per failure and never retried', () => {
      const onError = vi.fn();
      const owner = {};
      const remove = vi.fn(throwing('boom'));
      const set = new ListenerSet(onError);
      set.subscribe(owner, remove);

      set.detach(owner);
      set.detach(owner);

      expect(remove).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledTimes(1);
    });

    it('also applies to detachAll(): every owner is still cleaned up', () => {
      const onError = vi.fn();
      const emitter = new EventEmitter();
      const set = new ListenerSet(onError);
      set.subscribe({}, throwing('bad'));
      set.on(emitter, 'x', vi.fn());

      expect(() => set.detachAll()).not.toThrow();

      expect(emitter.listenerCount('x')).toBe(0);
      expect(onError).toHaveBeenCalledTimes(1);
    });

    it('without an onError handler, finishes every removal and then rethrows the first error', () => {
      const owner = {};
      const after = vi.fn();
      const set = new ListenerSet();
      set.subscribe(owner, throwing('first'));
      set.subscribe(owner, throwing('second'));
      set.subscribe(owner, after);

      expect(() => set.detach(owner)).toThrow('first');
      expect(after).toHaveBeenCalledTimes(1);
    });
  });

  describe('subscribe(owner, unsubscribe)', () => {
    it('runs the unsubscribe once, when its owner is detached', () => {
      const owner = {};
      const unsubscribe = vi.fn();
      const set = new ListenerSet();
      set.subscribe(owner, unsubscribe);
      expect(unsubscribe).not.toHaveBeenCalled();

      set.detach(owner);
      set.detach(owner);

      expect(unsubscribe).toHaveBeenCalledTimes(1);
    });

    it('is ordered together with on() listeners of the same owner', () => {
      const log: string[] = [];
      const emitter = new LoggedEmitter('e', log);
      const set = new ListenerSet();
      set.on(emitter, 'a', () => {});
      set.subscribe(emitter, () => log.push('unsubscribed'));
      set.on(emitter, 'b', () => {});
      log.length = 0;

      set.detach(emitter);

      expect(log).toEqual(['off:e:a', 'unsubscribed', 'off:e:b']);
    });
  });

  describe('detachAll()', () => {
    it('removes everything still attached, whatever the owner', () => {
      const a = new EventEmitter();
      const b = new EventEmitter();
      const unsubscribe = vi.fn();
      const set = new ListenerSet();
      set.on(a, 'x', vi.fn());
      set.on(b, 'y', vi.fn());
      set.subscribe({}, unsubscribe);

      set.detachAll();

      expect(a.listenerCount('x')).toBe(0);
      expect(b.listenerCount('y')).toBe(0);
      expect(unsubscribe).toHaveBeenCalledTimes(1);
      expect(set.size).toBe(0);
    });

    it('can be followed by more attachments', () => {
      const emitter = new EventEmitter();
      const set = new ListenerSet();
      set.on(emitter, 'x', vi.fn());
      set.detachAll();
      const listener = vi.fn();

      set.on(emitter, 'x', listener);
      emitter.emit('x');

      expect(listener).toHaveBeenCalledTimes(1);
      expect(set.size).toBe(1);
    });
  });

  it('works with any object that has on() and off(), not only EventEmitter', () => {
    const handlers = new Map<string, (...a: any[]) => void>();
    const fake: EmitterLike = {
      on: (event, l) => void handlers.set(event, l),
      off: (event) => void handlers.delete(event),
    };
    const set = new ListenerSet();

    set.on(fake, 'tick', () => {});
    expect(handlers.has('tick')).toBe(true);
    set.detach(fake);
    expect(handlers.has('tick')).toBe(false);
  });
});
