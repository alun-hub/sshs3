import os from 'node:os';
import path from 'node:path';

/**
 * Expands a leading `~` to the user's home directory. Neither Node's `fs`
 * module nor a directly-spawned `ssh-keygen` (no shell involved, so no
 * shell-side tilde expansion either) understand `~` on their own — passing
 * it through unexpanded silently created a literal `~/.ssh/...` directory
 * under the app's current working directory instead of the user's real home
 * directory. Every path the smartcard modules touch must go through this first.
 */
export function expandHome(p: string): string {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(os.homedir(), p.slice(2));
  return p;
}
