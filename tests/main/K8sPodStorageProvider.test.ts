import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough, Readable } from 'node:stream';
import type { K8sStorageConfig } from '../../src/shared/types/kubernetes';

const execMock = vi.fn();

class FakeConnection extends EventEmitter {
  close = vi.fn();
}

vi.mock('@kubernetes/client-node', () => {
  class KubeConfig {
    loadFromFile = vi.fn();
    loadFromDefault = vi.fn();
    loadFromOptions = vi.fn();
    getContexts = vi.fn(() => []);
    getClusters = vi.fn(() => []);
    getUsers = vi.fn(() => []);
  }
  class Exec {
    exec = execMock;
  }
  return { KubeConfig, Exec };
});

import { K8sPodStorageProvider } from '../../src/main/storage/K8sPodStorageProvider';

const CONFIG: K8sStorageConfig = {
  id: 'k8s-ctx/ns/test-pod/app',
  name: 'test-pod (app)',
  contextName: 'ctx',
  namespace: 'ns',
  podName: 'test-pod',
  containerName: 'app',
  initialPath: '/',
};

describe('K8sPodStorageProvider', () => {
  let provider: K8sPodStorageProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new K8sPodStorageProvider(CONFIG);
  });

  it('initializes with correct properties', () => {
    expect(provider.id).toBe('k8s-ctx/ns/test-pod/app');
    expect(provider.name).toBe('test-pod (app)');
    expect(provider.type).toBe('k8s');
  });

  it('lists directory contents correctly', async () => {
    execMock.mockImplementation(
      async (
        _ns: string,
        _pod: string,
        _container: string,
        _cmd: string[],
        stdout: PassThrough,
        _stderr: PassThrough,
        _stdin: any,
        _tty: boolean,
        statusCb: any
      ) => {
        const fakeOutput = [
          'app.js\t0\t1024 1727200000 644',
          'logs\t1\t4096 1727200000 755',
        ].join('\n');
        stdout.write(fakeOutput);
        stdout.end();
        statusCb({ status: 'Success' });
        return new FakeConnection();
      }
    );

    const entries = await provider.list('/var');
    expect(entries).toHaveLength(2);
    // Directories sorted first
    expect(entries[0].name).toBe('logs');
    expect(entries[0].isDirectory).toBe(true);
    expect(entries[0].path).toBe('/var/logs');
    expect(entries[0].permissions).toBe('755');

    expect(entries[1].name).toBe('app.js');
    expect(entries[1].isDirectory).toBe(false);
    expect(entries[1].path).toBe('/var/app.js');
    expect(entries[1].size).toBe(1024);
    expect(entries[1].permissions).toBe('644');
  });

  it('stats root directory without exec call', async () => {
    const entry = await provider.stat('/');
    expect(entry.name).toBe('/');
    expect(entry.isDirectory).toBe(true);
    expect(entry.path).toBe('/');
    expect(execMock).not.toHaveBeenCalled();
  });

  it('stats specific file', async () => {
    execMock.mockImplementation(
      async (
        _ns: string,
        _pod: string,
        _container: string,
        _cmd: string[],
        stdout: PassThrough,
        _stderr: PassThrough,
        _stdin: any,
        _tty: boolean,
        statusCb: any
      ) => {
        stdout.write('0\t2048 1727200000 600\n');
        stdout.end();
        statusCb({ status: 'Success' });
        return new FakeConnection();
      }
    );

    const entry = await provider.stat('/etc/config.json');
    expect(entry.name).toBe('config.json');
    expect(entry.path).toBe('/etc/config.json');
    expect(entry.size).toBe(2048);
    expect(entry.isDirectory).toBe(false);
    expect(entry.permissions).toBe('600');
  });

  it('creates folder', async () => {
    execMock.mockImplementation(
      async (
        _ns: string,
        _pod: string,
        _container: string,
        cmd: string[],
        _stdout: PassThrough,
        _stderr: PassThrough,
        _stdin: any,
        _tty: boolean,
        statusCb: any
      ) => {
        expect(cmd).toEqual(['sh', '-c', 'mkdir -p -- "$1"', '--', '/data/newfolder']);
        statusCb({ status: 'Success' });
        return new FakeConnection();
      }
    );

    await provider.createFolder('/data/newfolder');
  });

  it('deletes file or directory', async () => {
    execMock.mockImplementation(
      async (
        _ns: string,
        _pod: string,
        _container: string,
        cmd: string[],
        _stdout: PassThrough,
        _stderr: PassThrough,
        _stdin: any,
        _tty: boolean,
        statusCb: any
      ) => {
        expect(cmd).toEqual(['sh', '-c', 'rm -rf -- "$1"', '--', '/tmp/olddir']);
        statusCb({ status: 'Success' });
        return new FakeConnection();
      }
    );

    await provider.delete('/tmp/olddir', true);
  });

  it('refuses to delete container root directory', async () => {
    await expect(provider.delete('/', true)).rejects.toThrow('Refusing to delete container root directory');
  });

  it('renames file', async () => {
    execMock.mockImplementation(
      async (
        _ns: string,
        _pod: string,
        _container: string,
        cmd: string[],
        _stdout: PassThrough,
        _stderr: PassThrough,
        _stdin: any,
        _tty: boolean,
        statusCb: any
      ) => {
        expect(cmd).toEqual(['sh', '-c', 'mv -- "$1" "$2"', '--', '/tmp/a.txt', '/tmp/b.txt']);
        statusCb({ status: 'Success' });
        return new FakeConnection();
      }
    );

    await provider.rename('/tmp/a.txt', '/tmp/b.txt');
  });

  it('chmods file', async () => {
    execMock.mockImplementation(
      async (
        _ns: string,
        _pod: string,
        _container: string,
        cmd: string[],
        _stdout: PassThrough,
        _stderr: PassThrough,
        _stdin: any,
        _tty: boolean,
        statusCb: any
      ) => {
        expect(cmd).toEqual(['sh', '-c', 'chmod "$2" -- "$1"', '--', '/tmp/script.sh', '755']);
        statusCb({ status: 'Success' });
        return new FakeConnection();
      }
    );

    await provider.chmod('/tmp/script.sh', 0o755);
  });

  it('reads file content via readFile', async () => {
    execMock.mockImplementation(
      async (
        _ns: string,
        _pod: string,
        _container: string,
        _cmd: string[],
        stdout: PassThrough,
        _stderr: PassThrough,
        _stdin: any,
        _tty: boolean,
        statusCb: any
      ) => {
        stdout.write(Buffer.from('hello from pod'));
        stdout.end();
        statusCb({ status: 'Success' });
        return new FakeConnection();
      }
    );

    const data = await provider.readFile('/etc/motd');
    expect(data.toString('utf-8')).toBe('hello from pod');
  });

  it('writes file content via writeFile', async () => {
    let capturedInput = '';
    execMock.mockImplementation(
      async (
        _ns: string,
        _pod: string,
        _container: string,
        _cmd: string[],
        _stdout: PassThrough,
        _stderr: PassThrough,
        stdin: Readable,
        _tty: boolean,
        statusCb: any
      ) => {
        stdin.on('data', (c) => {
          capturedInput += c.toString('utf-8');
        });
        stdin.on('end', () => {
          statusCb({ status: 'Success' });
        });
        return new FakeConnection();
      }
    );

    await provider.writeFile('/tmp/hello.txt', Buffer.from('new content'));
    expect(capturedInput).toBe('new content');
  });

  it('throws descriptive error on command failure', async () => {
    execMock.mockImplementation(
      async (
        _ns: string,
        _pod: string,
        _container: string,
        _cmd: string[],
        _stdout: PassThrough,
        stderr: PassThrough,
        _stdin: any,
        _tty: boolean,
        statusCb: any
      ) => {
        stderr.write('Permission denied\n');
        statusCb({
          status: 'Failure',
          message: 'command terminated with exit code 1',
          details: { causes: [{ reason: 'ExitCode', message: '1' }] },
        });
        return new FakeConnection();
      }
    );

    await expect(provider.readFile('/root/secret')).rejects.toThrow('Permission denied');
  });
});
