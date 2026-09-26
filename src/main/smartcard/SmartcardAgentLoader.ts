import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { AgentLifecycleManager } from '../ssh/AgentLifecycleManager';
import { AskpassServer, type AskpassPromptHandler } from './AskpassServer';
import { withPkcs11Lock } from './Pkcs11Lock';

const execFileAsync = promisify(execFile);

export interface LoadedSmartcardAgent {
  pid: number;
  socketPath: string;
  /**
   * Only set when the caller opted into `keepAskpassAliveForAgentLifetime`
   * (see LoadIntoPrivateAgentOptions) — still running, and wired into the
   * agent process's own environment, so a *later* sign request the agent
   * itself has to prompt for (not just this initial load) still goes
   * through this app's own PIN modal. The caller now owns stopping it
   * (`await askpassServer.stop()`) whenever the agent itself is torn down.
   */
  askpassServer?: AskpassServer;
}

/**
 * Substrings (case-insensitive) OpenSSH/its PKCS#11 or FIDO2 provider is
 * known to print when it's blocked waiting for a physical touch on the key
 * (as opposed to a PIN, which goes through the Askpass protocol instead).
 * This is informational text written straight to the child's stdout/stderr,
 * never a real prompt the OpenSSH askpass protocol asks us to answer, so it
 * has to be scraped from the process output rather than intercepted like a
 * PIN. Kept as an allowlist with graceful non-detection (rather than a
 * strict parse) since the exact wording varies across OpenSSH/libfido2
 * versions and platforms.
 */
const PRESENCE_HINT_PATTERNS: RegExp[] = [
  /confirm user presence/i,
  /touch (your|the) (security key|authenticator|yubikey|token)/i,
  /please touch/i,
];

/**
 * Whether an error from `execWithPresenceDetection` describes a completely
 * textless process failure — i.e. its message is exactly
 * "<bin> <args> exited with code N" with no trailing ": <detail>" suffix.
 * Exported so the "no resident credentials yet" heuristic below can be
 * unit-tested without spawning a real `ssh-add`.
 */
export function isTextlessExitFailure(err: unknown): boolean {
  return (
    err instanceof Error &&
    (/exited with code \d+$/.test(err.message) ||
      /exited with code \d+: Enter PIN for authenticator:?$/i.test(err.message))
  );
}

/**
 * Runs a command while watching its combined stdout/stderr for a physical
 * "touch the key" hint, invoking `onPresenceRequested` (at most once) the
 * moment one is seen. Resolves once the process exits 0, otherwise rejects
 * with an error describing the failure — mirrors the subset of
 * child_process.execFile's contract this module actually relies on
 * (a timeout, and a thrown error for a non-zero exit), since execFile itself
 * only buffers output until the process exits and so can never observe the
 * hint in time to still be useful.
 */
export function execWithPresenceDetection(
  bin: string,
  args: string[],
  opts: { env: NodeJS.ProcessEnv; timeoutMs: number },
  onPresenceRequested?: () => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const logPrefix = `[exec] ${bin} ${args.join(' ')}`;
    console.log(`${logPrefix}: spawning (pid pending), timeout=${opts.timeoutMs}ms`);
    const child = spawn(bin, args, { env: opts.env });
    console.log(`${logPrefix}: spawned pid=${child.pid}`);
    // None of our callers ever have interactive input to feed a child (PIN/touch both go through
    // Askpass/the device itself, never stdin) — but some OpenSSH tools fall back to an interactive
    // "Overwrite? (y/n)" stdin prompt in cases we don't otherwise detect (e.g. ssh-keygen finding a
    // same-scoped resident credential already on the token). Closing stdin immediately turns that
    // into a fast, clearly-worded failure (still captured below via fullOutput) instead of hanging
    // until the timeout — a real touch-blocked step and "waiting on stdin we'll never answer" would
    // otherwise look identical to the user.
    child.stdin?.end();
    let settled = false;
    let presenceCheckBuf = '';
    let presenceSignaled = false;
    // Captures everything the child prints, independent of presence detection above, purely so
    // a non-zero exit can surface *why* (e.g. "no FIDO authenticator found", a PIN retry count,
    // a missing ssh-sk-helper) instead of a bare exit code — ssh-add's own error text is the only
    // place that reason exists, and it was previously discarded here entirely.
    let fullOutput = '';

    const timer = setTimeout(() => {
      console.warn(`${logPrefix}: timed out after ${opts.timeoutMs}ms, killing pid=${child.pid}`);
      child.kill();
    }, opts.timeoutMs);

    const checkForPresenceHint = (streamName: 'stdout' | 'stderr') => (chunk: Buffer): void => {
      const text = chunk.toString();
      console.log(`${logPrefix} [${streamName}]: ${JSON.stringify(text)}`);
      fullOutput += text;
      if (presenceSignaled) return;
      presenceCheckBuf += text;
      if (PRESENCE_HINT_PATTERNS.some((re) => re.test(presenceCheckBuf))) {
        presenceSignaled = true;
        onPresenceRequested?.();
      }
    };
    child.stdout?.on('data', checkForPresenceHint('stdout'));
    child.stderr?.on('data', checkForPresenceHint('stderr'));

    child.on('error', (err) => {
      console.warn(`${logPrefix}: process error event:`, err);
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });

    child.on('close', (code) => {
      console.log(`${logPrefix}: closed with code ${code}`);
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        resolve();
      } else {
        const detail = fullOutput.trim();
        const suffix = detail ? `: ${detail}` : '';
        reject(new Error(`${bin} ${args.join(' ')} exited with code ${code}${suffix}`));
      }
    });
  });
}

export interface AgentIdentity {
  bits: string;
  fingerprint: string;
  comment: string;
  keyType: string;
}

/**
 * Lists the identities an ssh-agent currently holds (`ssh-add -l`), parsed
 * into structured entries. For a PKCS#11-loaded smartcard key this surfaces
 * the certificate's label as `comment` (e.g. "PIV AUTH pubkey"). Returns an
 * empty array if the agent holds nothing, or can't be reached.
 */
export async function listAgentIdentities(socketPath: string): Promise<AgentIdentity[]> {
  const sshAddBin = process.platform === 'win32' ? 'ssh-add.exe' : 'ssh-add';
  const { stdout } = await execFileAsync(sshAddBin, ['-l'], {
    env: { ...process.env, SSH_AUTH_SOCK: socketPath },
  }).catch(() => ({ stdout: '' }));

  if (!stdout || stdout.toLowerCase().includes('no identities')) {
    return [];
  }

  const identities: AgentIdentity[] = [];
  for (const line of stdout.split('\n')) {
    const match = line.trim().match(/^(\d+)\s+(\S+)\s+(.*)\s+\(([^)]+)\)$/);
    if (match) {
      identities.push({ bits: match[1], fingerprint: match[2], comment: match[3], keyType: match[4] });
    }
  }
  return identities;
}

export interface LoadIntoPrivateAgentOptions {
  retries?: number;
  retryDelayMs?: number;
  /** Called (possibly more than once, across retries) when the card/key appears to be waiting for a physical touch. */
  onPresenceRequested?: () => void;
  /** Called once the attempt that triggered `onPresenceRequested` has finished, successfully or not. */
  onPresenceCleared?: () => void;
  /**
   * `ssh-add -K` exits non-zero with *zero* stdout/stderr output (no touch
   * prompt, no error text, the PIN's own retry counter unaffected by a
   * correct PIN) when the connected authenticator simply has no resident
   * SSH credentials yet — this is an OpenSSH quirk, not a real failure, and
   * was previously indistinguishable from a genuine error, causing a
   * needless 3-retry PIN-reprompt loop for what is really just "nothing to
   * load". When set, a completely textless failure is treated as success
   * with zero identities loaded rather than retried/thrown. Only
   * appropriate for `-K` (FIDO2 resident keys) — a PIV `-s <lib>` failure
   * always has real, non-empty diagnostic text.
   */
  emptyFailureMeansNoIdentities?: boolean;
  /**
   * Keeps the Askpass server backing this load running (and wires its env
   * into the spawned agent PROCESS itself, not just this one load call)
   * instead of stopping it once the load finishes. Needed for FIDO2 keys
   * generated with `-O verify-required`: the agent re-prompts for PIN+touch
   * on every future signature, not just when the key is first loaded, and
   * that later prompt comes from the long-lived agent process — without
   * this, it falls back to whatever SSH_ASKPASS this app inherited (e.g.
   * the desktop's own ksshaskpass), popping up an unstyled system dialog
   * instead of this app's own PIN modal. The caller becomes responsible for
   * stopping the returned `askpassServer` when the agent itself is torn
   * down. Leave unset for short-lived, single-use agents (list/generate
   * flows) where nothing signs anything after the load completes anyway.
   */
  keepAskpassAliveForAgentLifetime?: boolean;
}

/**
 * Spawns a private, app-managed ssh-agent and runs `ssh-add <addArgs>`
 * against it, prompting for the PIN via our own AskpassServer. Shared by
 * `loadSmartcardIntoPrivateAgent` (PIV/PKCS#11, `-s <lib>`) and
 * `loadFido2ResidentKeysIntoPrivateAgent` (FIDO2 discoverable credentials,
 * `-K`) — both are "hand a physical key's credentials to a throwaway agent"
 * operations with identical PIN-caching, retry and touch-detection needs,
 * differing only in the literal ssh-add invocation.
 *
 * Deliberately never touches the process's inherited SSH_AUTH_SOCK (e.g.
 * the desktop's gnome-keyring/KWallet agent) — reusing that agent is what
 * causes the OS to independently (and repeatedly) prompt for the same
 * smartcard's PIN outside of sshs3's own UI. On failure, the spawned agent
 * is killed before the error propagates.
 *
 * Retries the ssh-add step a few times: most PIV/FIDO2 readers only allow
 * one active transaction at a time, so this can transiently collide with
 * another process still holding the card right after the PIN was entered.
 * The user is only ever asked for the PIN once — its answer is cached and
 * reused for every retry, whether promptHandler is a live interactive
 * prompt or a fixed, already-known-good value — retries repeat the
 * mechanical ssh-add step, never the human interaction.
 */
async function runAddIntoPrivateAgent(
  addArgs: string[],
  promptHandler: AskpassPromptHandler,
  options?: LoadIntoPrivateAgentOptions
): Promise<LoadedSmartcardAgent> {
  const keepAlive = options?.keepAskpassAliveForAgentLifetime ?? false;
  const logPrefix = `[smartcard] runAddIntoPrivateAgent(${addArgs.join(' ')})`;

  // Caches the PIN for the duration of THIS load's own retry loop only (so the user isn't asked
  // again for a mechanical ssh-add retry after a transient collision) — deliberately NOT reused
  // once the load finishes: for `keepAlive`, the AskpassServer's handler is swapped below to the
  // raw (non-caching) `promptHandler`, so a *future* signature request — potentially minutes later,
  // and needing a fresh touch regardless of PIN — always gets its own live prompt rather than
  // silently replaying whatever was typed at load time.
  let cachedPin: string | undefined;
  let inFlightPrompt: Promise<string> | undefined;
  const cachingPromptHandler: AskpassPromptHandler = async (prompt) => {
    // Only reuse cached key PIN if the prompt is for the authenticator, key, or smartcard passphrase/PIN.
    // If OpenSSH is asking for a server/account password (e.g. "user@host's password:"), never supply the key PIN.
    const isAccountPasswordPrompt = /password/i.test(prompt) && !/pin|passphrase/i.test(prompt);
    if (!isAccountPasswordPrompt && cachedPin !== undefined) {
      console.log(`${logPrefix}: reusing already-entered PIN for a retry (prompt: "${prompt}")`);
      return cachedPin;
    }
    if (inFlightPrompt) {
      console.log(`${logPrefix}: awaiting in-flight PIN prompt (prompt: "${prompt}")`);
      return inFlightPrompt;
    }
    console.log(`${logPrefix}: asking for a fresh PIN (prompt: "${prompt}")`);
    inFlightPrompt = (async () => {
      try {
        const pin = await promptHandler(prompt);
        if (!isAccountPasswordPrompt) {
          cachedPin = pin;
        }
        return pin;
      } finally {
        inFlightPrompt = undefined;
      }
    })();
    return inFlightPrompt;
  };

  const askpassServer = new AskpassServer({
    promptHandler: cachingPromptHandler,
    onPresence: () => options?.onPresenceRequested?.(),
  });
  await askpassServer.start();
  const { pid, socketPath } = await AgentLifecycleManager.spawnPrivateAgent(
    keepAlive ? askpassServer.getEnv() : undefined
  );

  const retries = options?.retries ?? 3;
  const retryDelayMs = options?.retryDelayMs ?? 1200;

  try {
    const sshAddBin = process.platform === 'win32' ? 'ssh-add.exe' : 'ssh-add';
    const env = {
      ...process.env,
      SSH_AUTH_SOCK: socketPath,
      ...askpassServer.getEnv(),
    };

    let lastErr: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      console.log(`${logPrefix}: attempt ${attempt + 1}/${retries + 1}`);
      try {
        // See Pkcs11Lock's doc comment: this is the one moment this process actually opens a
        // PKCS#11/FIDO2 session against the token, so it must never race a concurrent load for
        // a different session, or the global agent's cert read, against the same physical card.
        await withPkcs11Lock(() =>
          execWithPresenceDetection(sshAddBin, addArgs, { env, timeoutMs: 60000 }, options?.onPresenceRequested)
        );
        lastErr = undefined;
      } catch (err) {
        console.warn(`${logPrefix}: attempt ${attempt + 1} failed:`, err);
        lastErr = err;
      } finally {
        options?.onPresenceCleared?.();
      }

      // ssh-add's exit code isn't reliable when the card add is refused
      // (observed exiting 0 despite reporting "agent refused operation"), so
      // verify directly against the agent rather than trusting it.
      const listRes = await execFileAsync(sshAddBin, ['-l'], { env }).catch(() => ({ stdout: '' }));
      if (listRes.stdout && !listRes.stdout.toLowerCase().includes('no identities')) {
        lastErr = undefined;
        break;
      }

      if (options?.emptyFailureMeansNoIdentities && (!lastErr || isTextlessExitFailure(lastErr))) {
        console.log(
          `${logPrefix}: treating success/textless failure with no identities as "no resident credentials on this device", not an error`
        );
        lastErr = undefined;
        break;
      }

      if (!lastErr) {
        lastErr = new Error(`ssh-add ${addArgs.join(' ')} reported success but no identity was loaded`);
      }

      const errMsg = lastErr instanceof Error ? lastErr.message.toLowerCase() : '';
      const isFatalCardOrPinError =
        errMsg.includes('agent refused operation') ||
        errMsg.includes('incorrect passphrase') ||
        errMsg.includes('bad passphrase') ||
        errMsg.includes('pin incorrect') ||
        errMsg.includes('pin blocked');

      if (isFatalCardOrPinError) {
        console.warn(`${logPrefix}: non-retryable error encountered: ${errMsg}`);
        break;
      }

      if (cachedPin === '' || attempt >= retries) {
        console.log(
          `${logPrefix}: giving up (${cachedPin === '' ? 'user cancelled' : 'out of retries'})`
        );
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
    if (lastErr) throw lastErr;
  } catch (err) {
    AgentLifecycleManager.killPrivateAgent(pid);
    if (keepAlive) await askpassServer.stop();
    throw err;
  } finally {
    if (!keepAlive) {
      await askpassServer.stop();
    }
  }

  if (keepAlive) {
    // Keep using the PIN that was entered during the load step for subsequent signature
    // requests during this session, rather than forcing the user to re-type the exact same PIN
    // a split-second later when ssh initiates public-key authentication.
    askpassServer.setPromptHandler(cachingPromptHandler);
    if (options?.onPresenceRequested) {
      askpassServer.setOnPresence(() => options.onPresenceRequested?.());
    }
  }

  return { pid, socketPath, askpassServer: keepAlive ? askpassServer : undefined };
}

/**
 * Loads a PKCS#11 module's PIV key into a private, app-managed ssh-agent.
 * See `runAddIntoPrivateAgent` for the shared retry/PIN/presence machinery.
 */
export async function loadSmartcardIntoPrivateAgent(
  pkcs11LibPath: string,
  promptHandler: AskpassPromptHandler,
  options?: LoadIntoPrivateAgentOptions
): Promise<LoadedSmartcardAgent> {
  return runAddIntoPrivateAgent(['-s', pkcs11LibPath], promptHandler, options);
}

/**
 * Loads every FIDO2 discoverable ("resident") credential on a connected
 * security key into a private, app-managed ssh-agent (`ssh-add -K`). Unlike
 * `loadSmartcardIntoPrivateAgent`, this isn't scoped to one library path —
 * it's whatever resident credentials the currently plugged-in authenticator
 * holds — so there's no PKCS#11Lock-style keying by library needed beyond
 * the same single-transaction-at-a-time guard `runAddIntoPrivateAgent`
 * already applies.
 */
export async function loadFido2ResidentKeysIntoPrivateAgent(
  promptHandler: AskpassPromptHandler,
  options?: LoadIntoPrivateAgentOptions
): Promise<LoadedSmartcardAgent> {
  return runAddIntoPrivateAgent(['-K'], promptHandler, { emptyFailureMeansNoIdentities: true, ...options });
}
