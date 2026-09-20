import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import net from 'node:net';
import fs from 'node:fs';
import { EventEmitter } from 'node:events';

const { mockSpawn } = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: (...args: any[]) => mockSpawn(...args),
  };
});

vi.mock('electron', () => ({
  app: {
    getAppPath: vi.fn().mockReturnValue('/app'),
  },
}));

import { XServerManager } from '../../src/main/x11/XServerManager';

describe('XServerManager', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(async () => {
    await XServerManager.stopServer();
  });

  describe('detectExecutable', () => {
    it('returns customPath if file exists on disk', async () => {
      vi.spyOn(fs, 'existsSync').mockImplementation((p) => p === 'C:\\custom\\vcxsrv.exe');
      const result = await XServerManager.detectExecutable('C:\\custom\\vcxsrv.exe');
      expect(result).toBe('C:\\custom\\vcxsrv.exe');
    });

    it('returns null on non-win32 platforms without custom path', async () => {
      const origPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'linux' });
      try {
        const result = await XServerManager.detectExecutable();
        expect(result).toBeNull();
      } finally {
        Object.defineProperty(process, 'platform', { value: origPlatform });
      }
    });

    it('finds executable in standard Windows paths when running on win32', async () => {
      const origPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'win32' });
      vi.spyOn(fs, 'existsSync').mockImplementation((p) => p === 'C:\\Program Files\\VcXsrv\\vcxsrv.exe');
      try {
        const result = await XServerManager.detectExecutable();
        expect(result).toBe('C:\\Program Files\\VcXsrv\\vcxsrv.exe');
      } finally {
        Object.defineProperty(process, 'platform', { value: origPlatform });
      }
    });
  });

  describe('isListening', () => {
    it('returns true when TCP connection succeeds', async () => {
      const mockSocket = new EventEmitter() as any;
      mockSocket.destroy = vi.fn();
      vi.spyOn(net, 'createConnection').mockImplementation((() => {
        setTimeout(() => mockSocket.emit('connect'), 10);
        return mockSocket;
      }) as any);

      const res = await XServerManager.isListening('127.0.0.1:0.0');
      expect(res.running).toBe(true);
      expect(res.display).toBe('127.0.0.1:0.0');
      expect(mockSocket.destroy).toHaveBeenCalled();
    });

    it('returns false when TCP connection fails or errors', async () => {
      const mockSocket = new EventEmitter() as any;
      mockSocket.destroy = vi.fn();
      vi.spyOn(net, 'createConnection').mockImplementation((() => {
        setTimeout(() => mockSocket.emit('error', new Error('ECONNREFUSED')), 10);
        return mockSocket;
      }) as any);

      const res = await XServerManager.isListening('127.0.0.1:0.0');
      expect(res.running).toBe(false);
      expect(res.display).toBe('127.0.0.1:0.0');
      expect(mockSocket.destroy).toHaveBeenCalled();
    });

    it('correctly calculates port from display offset (e.g. :1 -> 6001)', async () => {
      let connectedPort: number | undefined;
      const mockSocket = new EventEmitter() as any;
      mockSocket.destroy = vi.fn();
      vi.spyOn(net, 'createConnection').mockImplementation(((opts: any) => {
        connectedPort = opts.port;
        setTimeout(() => mockSocket.emit('connect'), 5);
        return mockSocket;
      }) as any);

      await XServerManager.isListening(':1');
      expect(connectedPort).toBe(6001);
    });
  });

  describe('getStatus', () => {
    it('reports availability, running state, and display', async () => {
      vi.spyOn(XServerManager, 'detectExecutable').mockResolvedValue('C:\\tools\\vcxsrv.exe');
      vi.spyOn(XServerManager, 'isListening').mockResolvedValue({ running: true, display: '127.0.0.1:0.0' });

      const status = await XServerManager.getStatus();
      expect(status.available).toBe(true);
      expect(status.executablePath).toBe('C:\\tools\\vcxsrv.exe');
      expect(status.running).toBe(true);
      expect(status.display).toBe('127.0.0.1:0.0');
    });
  });

  describe('startServer and stopServer lifecycle', () => {
    it('returns success: false with clear message if no executable found', async () => {
      vi.spyOn(XServerManager, 'isListening').mockResolvedValue({ running: false, display: '127.0.0.1:0.0' });
      vi.spyOn(XServerManager, 'detectExecutable').mockResolvedValue(null);

      const res = await XServerManager.startServer();
      expect(res.success).toBe(false);
      expect(res.error).toContain('No X server executable found');
    });

    it('skips spawning if server is already listening', async () => {
      vi.spyOn(XServerManager, 'isListening').mockResolvedValue({ running: true, display: '127.0.0.1:0.0' });

      const res = await XServerManager.startServer();
      expect(res.success).toBe(true);
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('spawns child process, unrefs, and tracks process pid', async () => {
      vi.spyOn(XServerManager, 'isListening')
        .mockResolvedValueOnce({ running: false, display: '127.0.0.1:0.0' })
        .mockResolvedValue({ running: true, display: '127.0.0.1:0.0' });
      vi.spyOn(XServerManager, 'detectExecutable').mockResolvedValue('C:\\VcXsrv\\vcxsrv.exe');

      const mockProc = new EventEmitter() as any;
      mockProc.pid = 4321;
      mockProc.unref = vi.fn();
      mockSpawn.mockReturnValue(mockProc);

      const res = await XServerManager.startServer();
      expect(res.success).toBe(true);
      expect(mockSpawn).toHaveBeenCalledWith(
        'C:\\VcXsrv\\vcxsrv.exe',
        // No '-ac': that flag disables X11 access control, letting any host
        // that can reach the port connect with zero authentication.
        [':0', '-multiwindow', '-clipboard', '-wgl'],
        expect.objectContaining({ detached: true })
      );
      expect(mockProc.unref).toHaveBeenCalled();

      // Check that status reflects managedByApp
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true as any);
      const status = await XServerManager.getStatus();
      expect(status.managedByApp).toBe(true);
      expect(status.pid).toBe(4321);

      // Stop server
      await XServerManager.stopServer();
      expect(killSpy).toHaveBeenCalledWith(4321, 'SIGTERM');

      const postStopStatus = await XServerManager.getStatus();
      expect(postStopStatus.managedByApp).toBe(false);
    });

    it('supports custom args when supplied', async () => {
      vi.spyOn(XServerManager, 'isListening')
        .mockResolvedValueOnce({ running: false, display: '127.0.0.1:0.0' })
        .mockResolvedValue({ running: true, display: '127.0.0.1:0.0' });
      vi.spyOn(XServerManager, 'detectExecutable').mockResolvedValue('C:\\VcXsrv\\vcxsrv.exe');

      const mockProc = new EventEmitter() as any;
      mockProc.pid = 9999;
      mockProc.unref = vi.fn();
      mockSpawn.mockReturnValue(mockProc);

      await XServerManager.startServer({ customArgs: ':1 -ac -nodecoration' });
      expect(mockSpawn).toHaveBeenCalledWith(
        'C:\\VcXsrv\\vcxsrv.exe',
        [':1', '-ac', '-nodecoration'],
        expect.anything()
      );
    });
  });

  describe('ensureRunning', () => {
    it('returns true immediately if server is already running', async () => {
      vi.spyOn(XServerManager, 'isListening').mockResolvedValue({ running: true, display: '127.0.0.1:0.0' });
      const startSpy = vi.spyOn(XServerManager, 'startServer');

      const running = await XServerManager.ensureRunning();
      expect(running).toBe(true);
      expect(startSpy).not.toHaveBeenCalled();
    });

    it('attempts startServer if not running and returns success flag', async () => {
      vi.spyOn(XServerManager, 'isListening').mockResolvedValue({ running: false, display: '127.0.0.1:0.0' });
      vi.spyOn(XServerManager, 'startServer').mockResolvedValue({ success: true });

      const running = await XServerManager.ensureRunning();
      expect(running).toBe(true);
      expect(XServerManager.startServer).toHaveBeenCalled();
    });
  });
});
