import { createLogger } from '../log';
import { expandHome } from './expandHome';
import { withPkcs11Lock } from './Pkcs11Lock';
import { TokenNotInsertedError } from './TokenNotInsertedError';
import { listConnectedYubiKeySerials, readKeyYubiKeySerial } from './YubiKeySerial';

const log = createLogger('fido2');

type WaitForToken = (kind: 'fido2', context: string, isPresent: () => Promise<boolean | undefined>) => Promise<boolean>;

/** A YubiKey seen plugged in is not asked about again for this long, so a burst of connections lists devices once. */
const PRESENT_CACHE_MS = 10_000;
const seenPresentAt = new Map<string, number>();

/** For tests: forget which YubiKeys were recently seen. */
export function resetYubiKeyPresenceCache(): void {
  seenPresentAt.clear();
}

/**
 * `ykman` opens the device, and `ssh-keygen`/`ssh-add` hold an exclusive FIDO session while they run, so listing goes through the
 * same app-wide token queue as every other physical-token operation.
 */
async function isYubiKeyPresent(serial: string): Promise<boolean | undefined> {
  const seen = seenPresentAt.get(serial);
  if (seen !== undefined && Date.now() - seen < PRESENT_CACHE_MS) return true;
  const connected = await withPkcs11Lock(() => listConnectedYubiKeySerials());
  const present = connected?.includes(serial);
  if (present) seenPresentAt.set(serial, Date.now());
  else seenPresentAt.delete(serial);
  return present;
}

/**
 * A security-key key file (`id_*_sk`) only works on the YubiKey that created it. When sshs3 generated the file it tagged the
 * YubiKey's serial number in the comment (see YubiKeySerial.ts); if that YubiKey is not among the connected ones, the user gets
 * the "insert your security key" prompt naming the serial, instead of ssh failing with `signing failed ... invalid format`.
 * Nothing is checked for a key without a tag, for other kinds of profile, or when the connected serials cannot be listed
 * (ykman missing, not Windows, or a connected device whose serial ykman cannot read). Throws TokenNotInsertedError when the
 * prompt is dismissed. A jump host is not checked: ProxyJump only takes user/host/port from the jump profile and reuses the
 * outer connection's identity, so no key file of its own is involved.
 */
export async function ensureKeyFileYubiKeyPresent(
  config: { authType?: string; fido2Resident?: boolean; privateKeyPath?: string },
  context: string,
  waitForToken: WaitForToken
): Promise<void> {
  if (config.authType !== 'fido2' || config.fido2Resident || !config.privateKeyPath) return;
  const expected = await readKeyYubiKeySerial(expandHome(config.privateKeyPath));
  if (!expected) return;
  const isPresent = () => isYubiKeyPresent(expected);
  if ((await isPresent()) !== false) return;
  log.info(`security key file ${config.privateKeyPath}: YubiKey ${expected} is not plugged in; asking the user to insert it`);
  if (!(await waitForToken('fido2', `${context} (YubiKey serial ${expected})`, isPresent))) throw new TokenNotInsertedError('fido2');
}
