import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { AgentLifecycleManager } from '../ssh/AgentLifecycleManager';
import { AskpassServer, type AskpassPromptHandler } from './AskpassServer';

const execFileAsync = promisify(execFile);

export interface LoadedSmartcardAgent {
  pid: number;
  socketPath: string;
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

/**
 * Spawns a private, app-managed ssh-agent and loads the given PKCS#11
 * module into it, prompting for the PIN via our own AskpassServer.
 *
 * Deliberately never touches the process's inherited SSH_AUTH_SOCK (e.g.
 * the desktop's gnome-keyring/KWallet agent) — reusing that agent is what
 * causes the OS to independently (and repeatedly) prompt for the same
 * smartcard's PIN outside of sshs3's own UI. On failure, the spawned agent
 * is killed before the error propagates.
 *
 * Retries the ssh-add step a few times: most PIV readers only allow one
 * active transaction at a time, so this can transiently collide with
 * another process still holding the card right after the PIN was entered.
 * The user is only ever asked for the PIN once — its answer is cached and
 * reused for every retry, whether promptHandler is a live interactive
 * prompt or a fixed, already-known-good value — retries repeat the
 * mechanical ssh-add step, never the human interaction.
 */
export async function loadSmartcardIntoPrivateAgent(
  pkcs11LibPath: string,
  promptHandler: AskpassPromptHandler,
  options?: { retries?: number; retryDelayMs?: number }
): Promise<LoadedSmartcardAgent> {
  const { pid, socketPath } = await AgentLifecycleManager.spawnPrivateAgent();

  let cachedPin: string | undefined;
  const cachingPromptHandler: AskpassPromptHandler = async (prompt) => {
    if (cachedPin === undefined) {
      cachedPin = await promptHandler(prompt);
    }
    return cachedPin;
  };

  const askpassServer = new AskpassServer({ promptHandler: cachingPromptHandler });
  await askpassServer.start();

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
      try {
        await execFileAsync(sshAddBin, ['-s', pkcs11LibPath], { env });
        lastErr = undefined;
      } catch (err) {
        lastErr = err;
      }

      // ssh-add -s's exit code isn't reliable when the card add is refused
      // (observed exiting 0 despite reporting "agent refused operation"), so
      // verify directly against the agent rather than trusting it.
      const listRes = await execFileAsync(sshAddBin, ['-l'], { env }).catch(() => ({ stdout: '' }));
      if (listRes.stdout && !listRes.stdout.toLowerCase().includes('no identities')) {
        lastErr = undefined;
        break;
      }
      if (!lastErr) {
        lastErr = new Error(`ssh-add -s ${pkcs11LibPath} reported success but no identity was loaded`);
      }
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    }
    if (lastErr) throw lastErr;
  } catch (err) {
    AgentLifecycleManager.killPrivateAgent(pid);
    throw err;
  } finally {
    await askpassServer.stop();
  }

  return { pid, socketPath };
}
