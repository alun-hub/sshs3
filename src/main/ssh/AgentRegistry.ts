import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * Crash-safe on-disk record of every private ssh-agent process and askpass
 * temp directory this app has spawned, so a *future* launch can find and
 * remove what a *previous* launch left behind.
 *
 * AgentLifecycleManager/AskpassServer already clean up after themselves on a
 * graceful exit (app.quit(), SIGINT/SIGTERM) — but that in-memory bookkeeping
 * is lost on SIGKILL, a crash, or an OOM-kill, leaving an ssh-agent process
 * (holding decrypted keys in memory) and its askpass socket directory behind
 * forever. This registry exists purely to recover from that: entries are
 * tagged with the owning process's PID, and cleanupOrphans() only acts on
 * entries whose owner is no longer alive, so it's safe even if multiple app
 * instances run concurrently (no single-instance lock is enforced).
 */
export interface AgentRegistryEntry {
  kind: 'agent';
  ownerPid: number;
  pid: number;
  createdAt: string;
}

export interface AskpassRegistryEntry {
  kind: 'askpass';
  ownerPid: number;
  tempDir: string;
  createdAt: string;
}

export type RegistryEntry = AgentRegistryEntry | AskpassRegistryEntry;

let registryDir: string | null = null;

/**
 * Must be called once at startup (e.g. with a path under app.getPath('userData'))
 * before register/unregister/cleanupOrphans do anything. Left unconfigured in
 * tests and other contexts that don't need crash recovery — every other
 * function here becomes a silent no-op in that case.
 */
export function configureRegistryDir(dir: string): void {
  registryDir = dir;
}

/** For tests: clears the configured directory so state doesn't leak between tests. */
export function _resetRegistryDir(): void {
  registryDir = null;
}

function isAlive(pid: number): boolean {
  try {
    // Signal 0 sends nothing; it just probes whether the process exists
    // and is visible to us.
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function registerEntry(entry: RegistryEntry): Promise<string | null> {
  if (!registryDir) return null;
  const dir = registryDir;
  try {
    await fs.mkdir(dir, { recursive: true });
    const id = crypto.randomUUID();
    await fs.writeFile(path.join(dir, `${id}.json`), JSON.stringify(entry), 'utf-8');
    return id;
  } catch {
    // Best-effort: if we can't persist the record, the resource still gets
    // cleaned up normally on graceful exit — we just lose crash recovery for it.
    return null;
  }
}

export async function unregisterEntry(id: string | null): Promise<void> {
  if (!registryDir || !id) return;
  try {
    await fs.rm(path.join(registryDir, `${id}.json`), { force: true });
  } catch {
    // Ignore
  }
}

export interface OrphanHandlers {
  onOrphanAgent: (pid: number) => void | Promise<void>;
  onOrphanAskpass: (tempDir: string) => void | Promise<void>;
}

/**
 * Scans every recorded entry and, for any whose owning process is no longer
 * alive, invokes the matching handler and removes the record. Entries owned
 * by a still-running process (another concurrent instance of the app) are
 * left untouched.
 */
export async function cleanupOrphans(handlers: OrphanHandlers): Promise<void> {
  if (!registryDir) return;
  const dir = registryDir;

  let files: string[];
  try {
    files = await fs.readdir(dir);
  } catch {
    return;
  }

  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const full = path.join(dir, file);

    try {
      const raw = await fs.readFile(full, 'utf-8');
      const entry = JSON.parse(raw) as RegistryEntry;

      if (isAlive(entry.ownerPid)) {
        continue; // Still owned by a live (possibly concurrent) instance.
      }

      if (entry.kind === 'agent') {
        await handlers.onOrphanAgent(entry.pid);
      } else if (entry.kind === 'askpass') {
        await handlers.onOrphanAskpass(entry.tempDir);
      }

      await fs.rm(full, { force: true });
    } catch {
      // Malformed/unreadable record — remove it so it doesn't linger forever.
      try {
        await fs.rm(full, { force: true });
      } catch {
        // Ignore
      }
    }
  }
}
