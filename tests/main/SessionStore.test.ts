import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { SessionStore } from '../../src/main/session/SessionStore';
import type { SessionData } from '../../src/shared/types/session';

describe('SessionStore', () => {
  let tempDir: string;
  let sessionFile: string;
  let store: SessionStore;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'multissh-session-test-'));
    sessionFile = path.join(tempDir, 'session.json');
    store = new SessionStore(sessionFile);
  });

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('returns null when session file does not exist', async () => {
    const session = await store.getSession();
    expect(session).toBeNull();
  });

  it('saves and retrieves session data with tabs and activeTabId', async () => {
    const data: SessionData = {
      tabs: [
        { id: 'tab-1', type: 'terminal', title: 'Prod Server' },
        { id: 'tab-2', type: 'filemanager', title: 'Filhanterare 1' },
      ],
      activeTabId: 'tab-2',
      lastPaths: {
        local: '/home/user/docs',
        'sftp-123': '/var/www',
      },
      panes: {
        left: { sourceType: 'local', providerId: 'local', label: 'Lokal disk', path: '/home/user' },
        right: { sourceType: 'sftp', providerId: 'sftp-123', label: 'Prod', path: '/var/www' },
      },
    };

    await store.saveSession(data);
    const loaded = await store.getSession();

    expect(loaded).toEqual(data);
  });

  it('returns null if file is corrupt JSON', async () => {
    await fs.writeFile(sessionFile, 'corrupt {json', 'utf-8');
    const loaded = await store.getSession();
    expect(loaded).toBeNull();
  });
});
