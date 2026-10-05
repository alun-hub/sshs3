import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { AgentLifecycleManager } from './AgentLifecycleManager';
import { AskpassServer, type AskpassPromptHandler } from '../smartcard/AskpassServer';
import { getAgentIdentities, getKeyAlgorithm } from '../smartcard/SmartcardSyncService';
import {
  listAgentIdentities,
  addSmartcardToAgent,
  addFido2ResidentKeysToAgent,
  type AgentIdentity,
  type AgentTarget,
  type LoadIntoPrivateAgentOptions,
} from '../smartcard/SmartcardAgentLoader';

const execFileAsync = promisify(execFile);

/** "Enter PIN and confirm user presence for ED25519-SK key SHA256:…" — a FIDO2 signature asking for its PIN. */
const FIDO2_SIGNATURE_PIN_PROMPT = /\bPIN\b.*(-SK\b|authenticator|security key|user presence)/i;
const FIDO2_PIN_REPLAY_WINDOW_MS = 3000;

/** sun_path is 104 bytes on macOS/BSD and 108 on Linux; stay below both. */
const MAX_UNIX_SOCKET_PATH = 100;

export interface AppAgentHandlers {
  /** Answers PIN/passphrase prompts raised by the agent itself (e.g. a later `verify-required` FIDO2 signature). */
  promptHandler?: AskpassPromptHandler;
  /** Called when the agent asks the user to touch a key. */
  onPresence?: (prompt: string) => void;
}

/** OpenSSH-style `SHA256:<base64, no padding>` fingerprint of a key blob (what `ssh-add -l` prints). */
export function fingerprintOfKeyBlob(keyBlob: Buffer): string {
  return `SHA256:${crypto.createHash('sha256').update(keyBlob).digest('base64').replace(/=+$/, '')}`;
}

/** Directory holding the app agent's socket; created 0700 and verified before use. */
export function resolveAppAgentDir(): string {
  const runtimeDir = process.env.XDG_RUNTIME_DIR;
  if (runtimeDir && path.isAbsolute(runtimeDir)) {
    return path.join(runtimeDir, 'sshs3');
  }
  const uid = typeof process.getuid === 'function' ? String(process.getuid()) : 'user';
  return path.join(os.tmpdir(), `sshs3-${uid}`);
}

/**
 * Creates `dir` (mode 0700) if missing and refuses to use it unless it is a real directory, owned by
 * this user and closed to group/others. The fallback location lives under a shared temp directory,
 * where another user could otherwise pre-create the path (or a symlink to somewhere they control)
 * and have the agent socket land in a place they can reach.
 */
async function ensureSecureDir(dir: string): Promise<void> {
  try {
    await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
  }
  const st = await fs.promises.lstat(dir);
  if (st.isSymbolicLink() || !st.isDirectory()) {
    throw new Error(`Refusing to use ${dir} for the app ssh-agent: not a plain directory`);
  }
  if (typeof process.getuid === 'function' && st.uid !== process.getuid()) {
    throw new Error(`Refusing to use ${dir} for the app ssh-agent: owned by another user`);
  }
  if ((st.mode & 0o077) !== 0) {
    throw new Error(`Refusing to use ${dir} for the app ssh-agent: accessible by group/others`);
  }
}

/**
 * One app-wide ssh-agent for the 'agent-global' PIN caching mode: every unlocked smartcard / FIDO2
 * key is loaded into it, and terminals and SFTP connections use its (stable) socket instead of one
 * private agent per device. The agent process is a normal private agent (registered in
 * AgentRegistry, killed on exit); this class adds the stable socket, the askpass server that lives as
 * long as the agent, and lock/list/remove. It does not load keys itself.
 *
 * On Windows the "agent" is the shared OpenSSH service pipe (which also holds identities this app
 * did not load), so locking only evicts the PKCS#11 libraries registered via `noteLoadedLibrary`.
 */
export class AppAgent {
  private pid = 0;
  private socketPath: string | null = null;
  private askpass: AskpassServer | null = null;
  private ensuring: Promise<string> | null = null;
  private loadedLibs = new Set<string>();
  private handlers: AppAgentHandlers = {};
  private onExit?: () => void;
  private addQueue: Promise<unknown> = Promise.resolve();

  /**
   * The PIN entered when the FIDO2 keys were loaded, kept in memory only until the keys are locked.
   * A `verify-required` key asks for PIN + touch on every signature; replaying this PIN means only the
   * touch is needed (what the per-card FIDO2 agent did before).
   */
  private fido2Pin: string | undefined;
  private lastFido2PinReplay = 0;

  private delegatePrompt: AskpassPromptHandler = (prompt, retry) => {
    if (this.fido2Pin !== undefined && FIDO2_SIGNATURE_PIN_PROMPT.test(prompt)) {
      const now = Date.now();
      if (now - this.lastFido2PinReplay > FIDO2_PIN_REPLAY_WINDOW_MS) {
        this.lastFido2PinReplay = now;
        return this.fido2Pin;
      }
      // Asked again right after a replay: the PIN was wrong (or changed). Never keep replaying it —
      // that would burn the authenticator's PIN retries — ask the user instead.
      this.fido2Pin = undefined;
    }
    return this.handlers.promptHandler?.(prompt, retry) ?? '';
  };
  private delegatePresence = (prompt: string): void => this.handlers.onPresence?.(prompt);

  /** Handlers used for prompts the agent raises after keys were loaded; can be changed at any time. */
  public setHandlers(handlers: AppAgentHandlers): void {
    this.handlers = handlers;
  }

  /** Called when the agent was found dead on a later ensure(), so the owner can drop state tied to its keys. */
  public setOnExit(callback: (() => void) | undefined): void {
    this.onExit = callback;
  }

  public getSocketPath(): string | null {
    return this.socketPath;
  }

  /** Records that a PKCS#11 library was loaded, so Windows can evict just it (see class comment). */
  public noteLoadedLibrary(pkcs11LibPath: string): void {
    this.loadedLibs.add(pkcs11LibPath);
  }

  /** Starts the agent if needed and returns its socket path. Concurrent callers share one start. */
  public ensure(): Promise<string> {
    if (!this.ensuring) {
      this.ensuring = this.doEnsure().finally(() => {
        this.ensuring = null;
      });
    }
    return this.ensuring;
  }

  private async doEnsure(): Promise<string> {
    if (this.socketPath) {
      if (await AgentLifecycleManager.probeSocket(this.socketPath)) {
        return this.socketPath;
      }
      console.warn('[app-agent] agent is no longer reachable; restarting');
      await this.discardDeadAgent();
    }

    if (process.platform === 'win32') {
      // The shared OpenSSH service; no stable path of our own and no askpass env to inject.
      const { pid, socketPath } = await AgentLifecycleManager.spawnPrivateAgent();
      this.pid = pid;
      this.socketPath = socketPath;
      return socketPath;
    }

    const dir = resolveAppAgentDir();
    await ensureSecureDir(dir);
    const wanted = await this.chooseSocketPath(dir);
    if (wanted.length > MAX_UNIX_SOCKET_PATH) {
      throw new Error(`App ssh-agent socket path is too long (${wanted.length} > ${MAX_UNIX_SOCKET_PATH}): ${wanted}`);
    }

    const askpass = new AskpassServer({
      promptHandler: this.delegatePrompt,
      onPresence: this.delegatePresence,
    });
    await askpass.start();
    try {
      const { pid, socketPath } = await AgentLifecycleManager.spawnPrivateAgent(askpass.getEnv(), {
        socketPath: wanted,
      });
      this.pid = pid;
      this.socketPath = socketPath;
      this.askpass = askpass;
      console.log(`[app-agent] started pid=${pid}, socket=${socketPath}`);
      return socketPath;
    } catch (err) {
      await askpass.stop().catch(() => {});
      throw err;
    }
  }

  /** Picks `agent.sock`, or `agent-<pid>.sock` when another live app instance already owns it. Removes stale sockets. */
  private async chooseSocketPath(dir: string): Promise<string> {
    for (const name of ['agent.sock', `agent-${process.pid}.sock`]) {
      const candidate = path.join(dir, name);
      let st: fs.Stats;
      try {
        st = await fs.promises.lstat(candidate);
      } catch {
        return candidate;
      }
      if (!st.isSocket()) {
        throw new Error(`Refusing to replace ${candidate}: not a socket`);
      }
      if (await AgentLifecycleManager.probeSocket(candidate)) continue;
      await fs.promises.unlink(candidate);
      return candidate;
    }
    throw new Error(`No free app ssh-agent socket in ${dir}`);
  }

  private async discardDeadAgent(): Promise<void> {
    const { pid, socketPath, askpass } = this;
    this.pid = 0;
    this.socketPath = null;
    this.askpass = null;
    this.loadedLibs.clear();
    this.fido2Pin = undefined;
    await askpass?.stop().catch(() => {});
    if (pid > 0) {
      AgentLifecycleManager.killPrivateAgent(pid);
      if (socketPath) await fs.promises.unlink(socketPath).catch(() => {});
    }
    this.onExit?.();
  }

  /** Loads a PKCS#11 module's key into the agent (PIN via `promptHandler`), starting the agent if needed. */
  public async addPkcs11(
    pkcs11LibPath: string,
    promptHandler: AskpassPromptHandler,
    options?: LoadIntoPrivateAgentOptions
  ): Promise<void> {
    await this.runAdd((target) => addSmartcardToAgent(target, pkcs11LibPath, promptHandler, options));
    this.noteLoadedLibrary(pkcs11LibPath);
  }

  /** Loads the connected security key's FIDO2 resident credentials into the agent. */
  public async addFido2Resident(promptHandler: AskpassPromptHandler, options?: LoadIntoPrivateAgentOptions): Promise<void> {
    let enteredPin: string | undefined;
    await this.runAdd((target) =>
      addFido2ResidentKeysToAgent(target, promptHandler, { ...options, onPinEntered: (pin) => (enteredPin = pin) })
    );
    // Only remember a PIN that actually unlocked the keys.
    if (enteredPin) this.fido2Pin = enteredPin;
  }

  /**
   * Adds are serialized: most readers only allow one PKCS#11/FIDO2 transaction at a time. Each add
   * prompts through its own askpass server (see AgentTarget), so the agent's askpass server — which
   * answers signature-time prompts — is never involved and keeps using this owner's handlers.
   */
  private runAdd(add: (target: AgentTarget) => Promise<unknown>): Promise<unknown> {
    const task = this.addQueue.then(async () => {
      const socketPath = await this.ensure();
      return add({ pid: this.pid, socketPath });
    });
    this.addQueue = task.catch(() => {});
    return task;
  }

  /**
   * Writes the public half of the agent's keys with the given fingerprints to files, so an `ssh -i
   * <file>.pub -o IdentitiesOnly=yes` run can select exactly those keys from this shared agent.
   * Public keys are not secret, but the files live in a verified 0700 directory (and are 0600) like
   * the socket. Not supported on Windows (shared service pipe): returns an empty list there.
   */
  public async writePublicKeyFiles(fingerprints: Iterable<string>): Promise<string[]> {
    const socketPath = this.socketPath;
    if (!socketPath || process.platform === 'win32') return [];
    const wanted = new Set(fingerprints);
    if (wanted.size === 0) return [];

    const dir = path.join(resolveAppAgentDir(), 'keys');
    await ensureSecureDir(path.dirname(dir));
    await ensureSecureDir(dir);

    const files: string[] = [];
    for (const identity of await getAgentIdentities(socketPath)) {
      if (!wanted.has(fingerprintOfKeyBlob(identity.keyBlob))) continue;
      const name = crypto.createHash('sha256').update(identity.keyBlob).digest('hex').slice(0, 32);
      const file = path.join(dir, `${name}.pub`);
      const comment = identity.comment.replace(/[\r\n]+/g, ' ');
      const line = `${getKeyAlgorithm(identity.keyBlob)} ${identity.keyBlob.toString('base64')} ${comment}\n`;
      await fs.promises.writeFile(file, line, { mode: 0o600 });
      files.push(file);
    }
    return files;
  }

  public async list(): Promise<AgentIdentity[]> {
    return this.socketPath ? listAgentIdentities(this.socketPath) : [];
  }

  /** Removes one PKCS#11 library's keys from the agent, leaving everything else loaded. */
  public async remove(pkcs11LibPath: string): Promise<void> {
    if (!this.socketPath) return;
    await AgentLifecycleManager.unloadCard(this.socketPath, pkcs11LibPath);
    this.loadedLibs.delete(pkcs11LibPath);
  }

  /** Forgets every key (the "lock" action) without stopping the agent, so its socket stays valid for open terminals. */
  public async lockAll(): Promise<void> {
    this.fido2Pin = undefined;
    const socketPath = this.socketPath;
    if (!socketPath) return;
    if (process.platform === 'win32') {
      for (const lib of this.loadedLibs) {
        await AgentLifecycleManager.unloadCard(socketPath, lib);
      }
    } else {
      await execFileAsync('ssh-add', ['-D'], { env: { ...process.env, SSH_AUTH_SOCK: socketPath } }).catch(() => {
        // Best-effort: nothing loaded, or the agent already went away.
      });
    }
    this.loadedLibs.clear();
  }

  /** Stops the agent and its askpass server and removes the socket. Safe to call repeatedly. */
  public async shutdown(): Promise<void> {
    const pid = this.pid;
    if (process.platform === 'win32' && this.socketPath) {
      await this.lockAll();
    }
    const { socketPath, askpass } = this;
    this.pid = 0;
    this.socketPath = null;
    this.askpass = null;
    this.loadedLibs.clear();
    this.fido2Pin = undefined;
    await askpass?.stop().catch(() => {});
    if (pid > 0) {
      AgentLifecycleManager.killPrivateAgent(pid);
      if (socketPath) await fs.promises.unlink(socketPath).catch(() => {});
    }
    if (process.platform !== 'win32') {
      await fs.promises.rm(path.join(resolveAppAgentDir(), 'keys'), { recursive: true, force: true }).catch(() => {});
    }
  }
}
