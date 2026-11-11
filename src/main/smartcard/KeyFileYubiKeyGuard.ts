import { createLogger } from '../log';
import { expandHome } from './Fido2KeyManager';
import { listConnectedYubiKeySerials, readKeyYubiKeySerial } from './YubiKeySerial';

const log = createLogger('fido2');

/** The user dismissed the "insert your token" prompt: the connection must stop, not fall back to another PIN prompt. */
export class TokenNotInsertedError extends Error {
  constructor(kind: 'smartcard' | 'fido2') {
    super(kind === 'fido2' ? 'No security key inserted' : 'No smartcard inserted');
    this.name = 'TokenNotInsertedError';
  }
}

type WaitForToken = (kind: 'fido2', context: string, isPresent: () => Promise<boolean | undefined>) => Promise<boolean>;

/**
 * A security-key key file (`id_*_sk`) only works on the YubiKey that created it. When sshs3 generated the file it tagged the
 * YubiKey's serial number in the comment (see YubiKeySerial.ts); if that YubiKey is not among the connected ones, the user gets
 * the "insert your security key" prompt naming the serial, instead of ssh failing with `signing failed ... invalid format`.
 * Nothing is checked for a key without a tag, for other kinds of profile, or when the connected serials cannot be listed
 * (ykman missing, not Windows). Throws TokenNotInsertedError when the prompt is dismissed.
 */
export async function ensureKeyFileYubiKeyPresent(
  config: { authType?: string; fido2Resident?: boolean; privateKeyPath?: string },
  context: string,
  waitForToken: WaitForToken
): Promise<void> {
  if (config.authType !== 'fido2' || config.fido2Resident || !config.privateKeyPath) return;
  const expected = await readKeyYubiKeySerial(expandHome(config.privateKeyPath));
  if (!expected) return;
  const isPresent = async () => (await listConnectedYubiKeySerials())?.includes(expected);
  if ((await isPresent()) !== false) return;
  log.info(`security key file ${config.privateKeyPath}: YubiKey ${expected} is not plugged in; asking the user to insert it`);
  if (!(await waitForToken('fido2', `${context} (YubiKey serial ${expected})`, isPresent))) throw new TokenNotInsertedError('fido2');
}
