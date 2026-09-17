import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { DotfilePoolStore } from '../../src/main/dotfiles/DotfilePoolStore';
import type { DotfilePool } from '../../src/shared/types/dotfiles';

describe('DotfilePoolStore with Master Files', () => {
  let tempDir: string;
  let storeFile: string;
  let store: DotfilePoolStore;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dotfile-store-test-'));
    storeFile = path.join(tempDir, 'dotfile-pools.json');
    store = new DotfilePoolStore(storeFile);
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it('saves pools and writes physical master files to disk in dotfiles/<poolId>/', async () => {
    const pool: DotfilePool = {
      id: 'pool-test-1',
      name: 'Server Configs',
      files: [
        {
          id: 'file-1',
          remotePath: '~/.bashrc',
          content: 'export FOO=BAR\nalias ll="ls -la"',
          mode: '644',
        },
        {
          id: 'file-2',
          remotePath: '~/.config/nvim/init.vim',
          content: 'set number\nset relativenumber',
          mode: '600',
        },
      ],
    };

    await store.savePool(pool);

    // Verify pools JSON is written
    const pools = await store.getPools();
    expect(pools).toHaveLength(1);
    expect(pools[0].name).toBe('Server Configs');
    expect(pools[0].updatedAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);

    // Verify physical master files exist on disk
    const poolDir = store.getPoolDirectory('pool-test-1');
    const bashrcPath = path.join(poolDir, '.bashrc');
    const nvimPath = path.join(poolDir, '.config', 'nvim', 'init.vim');

    const bashrcContent = await fs.readFile(bashrcPath, 'utf-8');
    expect(bashrcContent).toBe('export FOO=BAR\nalias ll="ls -la"');

    const nvimContent = await fs.readFile(nvimPath, 'utf-8');
    expect(nvimContent).toBe('set number\nset relativenumber');

    // Verify master file properties in returned pool
    expect(pools[0].files[0].masterFileName).toBe('.bashrc');
    expect(pools[0].files[0].masterFilePath).toBe(bashrcPath);
    expect(pools[0].files[0].updatedAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  it('automatically syncs modifications made directly to master files on disk', async () => {
    const pool: DotfilePool = {
      id: 'pool-test-sync',
      name: 'Sync Test',
      files: [
        {
          id: 'f-1',
          remotePath: '~/.zshrc',
          content: 'PROMPT="%m %~ %# "',
        },
      ],
    };

    await store.savePool(pool);

    // Edit master file on disk externally
    const masterPath = store.getMasterFilePath('pool-test-sync', '~/.zshrc');
    await fs.writeFile(masterPath, 'PROMPT="MODIFIED BY EXTERNAL EDITOR"', 'utf-8');

    // getPool should read disk content
    const reloaded = await store.getPool('pool-test-sync');
    expect(reloaded).toBeDefined();
    expect(reloaded!.files[0].content).toBe('PROMPT="MODIFIED BY EXTERNAL EDITOR"');
  });

  it('imports local files and reads their content and mode', async () => {
    const testFile1 = path.join(tempDir, 'test-bashrc');
    const testFile2 = path.join(tempDir, 'test-vimrc');

    await fs.writeFile(testFile1, '# Bash config\nexport PATH=$PATH:~/bin', 'utf-8');
    await fs.writeFile(testFile2, '" Vim config\nsyntax on', 'utf-8');

    const imported = await store.importLocalFiles([testFile1, testFile2]);
    expect(imported).toHaveLength(2);
    expect(imported[0].name).toBe('test-bashrc');
    expect(imported[0].content).toBe('# Bash config\nexport PATH=$PATH:~/bin');
    expect(imported[1].name).toBe('test-vimrc');
    expect(imported[1].content).toBe('" Vim config\nsyntax on');
  });

  it('adds files to an existing pool or creates one with addFileToPool', async () => {
    const updated = await store.addFileToPool('pool-quick', {
      remotePath: '~/.tmux.conf',
      content: 'set -g mouse on',
      mode: '644',
    });

    expect(updated.id).toBe('pool-quick');
    expect(updated.files).toHaveLength(1);
    expect(updated.files[0].remotePath).toBe('~/.tmux.conf');
    expect(updated.files[0].content).toBe('set -g mouse on');

    const poolDir = store.getPoolDirectory('pool-quick');
    const diskContent = await fs.readFile(path.join(poolDir, '.tmux.conf'), 'utf-8');
    expect(diskContent).toBe('set -g mouse on');

    // Adding same remotePath should update the existing file
    await store.addFileToPool('pool-quick', {
      remotePath: '~/.tmux.conf',
      content: 'set -g mouse on\nbind r source-file ~/.tmux.conf',
    });

    const poolAfterUpdate = await store.getPool('pool-quick');
    expect(poolAfterUpdate!.files).toHaveLength(1);
    expect(poolAfterUpdate!.files[0].content).toBe('set -g mouse on\nbind r source-file ~/.tmux.conf');
  });

  it('deletes pool and removes master file directory from disk', async () => {
    const pool: DotfilePool = {
      id: 'pool-to-delete',
      name: 'To Delete',
      files: [{ id: 'f-del', remotePath: '~/.profile', content: '# profile' }],
    };

    await store.savePool(pool);
    const poolDir = store.getPoolDirectory('pool-to-delete');
    expect(await fs.stat(poolDir).then(() => true, () => false)).toBe(true);

    await store.deletePool('pool-to-delete');
    const remaining = await store.getPools();
    expect(remaining).toHaveLength(0);

    const dirExists = await fs.stat(poolDir).then(() => true, () => false);
    expect(dirExists).toBe(false);
  });
});
