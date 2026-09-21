import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { FileTailService } from '../../src/main/editor/FileTailService';
import { StorageRegistry } from '../../src/main/storage/StorageRegistry';
import { LocalStorageProvider } from '../../src/main/storage/LocalStorageProvider';

describe('FileTailService', () => {
  let tempDir: string;
  let registry: StorageRegistry;
  let service: FileTailService;

  beforeEach(async () => {
    tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'sshs3-tail-test-'));
    registry = new StorageRegistry();
    const localProvider = new LocalStorageProvider({
      id: 'local-test',
      name: 'Local',
      basePath: tempDir,
    });
    registry.register(localProvider);
    service = new FileTailService();
  });

  afterEach(async () => {
    service.dispose();
    await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  it('fetches initial tail content and streams appended data via polling', async () => {
    const filePath = path.join(tempDir, 'test.log');
    await fsp.writeFile(filePath, 'Line 1\nLine 2\nLine 3\n');

    const dataEvents: string[] = [];
    const errorEvents: string[] = [];

    const result = await service.startTail(
      registry,
      'local-test',
      filePath,
      (event) => dataEvents.push(event.chunk),
      (event) => errorEvents.push(event.error)
    );

    expect(result.tailId).toBeDefined();
    expect(result.initialContent).toBe('Line 1\nLine 2\nLine 3\n');

    // Append new line to log file
    await fsp.appendFile(filePath, 'Line 4\n');

    // Wait for polling tick (2000ms)
    await new Promise((resolve) => setTimeout(resolve, 2200));

    expect(dataEvents.length).toBeGreaterThan(0);
    expect(dataEvents.join('')).toContain('Line 4\n');
    expect(errorEvents.length).toBe(0);

    service.stopTail(result.tailId);
  });

  it('stops tailing when stopTail is called', async () => {
    const filePath = path.join(tempDir, 'test2.log');
    await fsp.writeFile(filePath, 'Initial\n');

    const dataEvents: string[] = [];

    const result = await service.startTail(
      registry,
      'local-test',
      filePath,
      (event) => dataEvents.push(event.chunk),
      () => {}
    );

    service.stopTail(result.tailId);

    // Append after stop
    await fsp.appendFile(filePath, 'Appended after stop\n');
    await new Promise((resolve) => setTimeout(resolve, 2200));

    expect(dataEvents.length).toBe(0);
  });
});
