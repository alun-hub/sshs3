import type { InstallLoginMethod, InstallLoginStep, SSHAuthType } from './types/ssh';

const KEY_AUTH_TYPES: SSHAuthType[] = ['privateKey', 'agent', 'smartcard', 'fido2'];

export interface LoginOrderInput {
  authType: SSHAuthType;
  loginMethod?: InstallLoginMethod;
  /** true när de valda nycklarna bara är profilens egen inloggningsnyckel. */
  installsOwnKeyOnly?: boolean;
  /** Auth-metoder servern annonserade vid probe, om kända. */
  serverMethods?: string[];
  /** Profilen har ett PKCS#11-bibliotek angivet (t.ex. kvar från när den använde smartcard). */
  hasSmartcardLib?: boolean;
}

/**
 * Ordningen vi försöker logga in i för att installera nycklar. Regel: logga aldrig in med den nyckel som ska
 * installeras. Finns ett smartcard-bibliotek i profilen (typiskt kvar när man bytt till FIDO2) provas kortet
 * före lösenord, eftersom hosten ofta redan litar på det. En tom lista betyder att det inte finns någon
 * vettig inloggning (hosten tar bara nycklar och den enda nyckeln vi har är den som ska in).
 * Delas av main (som kör ordningen) och renderern (som visar den).
 */
export function chooseLoginOrder(opts: LoginOrderInput): InstallLoginStep[] {
  const { authType, loginMethod = 'auto', installsOwnKeyOnly = false, serverMethods, hasSmartcardLib = false } = opts;
  if (loginMethod !== 'auto') return [loginMethod];
  if (authType === 'password') return ['password'];

  const passwordAllowed =
    !serverMethods || serverMethods.includes('password') || serverMethods.includes('keyboard-interactive');
  const profileIsKey = KEY_AUTH_TYPES.includes(authType);
  const card: InstallLoginStep[] = hasSmartcardLib && authType !== 'smartcard' ? ['smartcard'] : [];
  const password: InstallLoginStep[] = passwordAllowed ? ['password'] : [];

  if (installsOwnKeyOnly && profileIsKey) return [...card, ...password];
  return ['profile', ...card, ...password];
}

export const LOGIN_STEP_LABELS: Record<InstallLoginStep, string> = {
  password: 'Password', // pragma: allowlist secret
  profile: "This profile's key",
  smartcard: 'Smartcard (PKCS#11)',
  agent: 'Already-unlocked keys (ssh-agent)',
};
