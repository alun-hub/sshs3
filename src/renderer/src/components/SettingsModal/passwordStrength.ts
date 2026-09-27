/**
 * Password strength estimation for the master password dialog (LOW finding,
 * code review: the previous heuristic only counted length/character
 * classes, so something like "Password1!" scored as strong despite being
 * a well-known weak choice). Backed by zxcvbn-ts, which actually checks
 * against common passwords/dictionary words/keyboard patterns.
 *
 * zxcvbn-ts and its English dictionary data are several MB, so they're
 * lazily imported only once a real strength check is needed (the first
 * time this dialog is shown), the same way @kubernetes/client-node is
 * lazy-loaded elsewhere in this app (see loadK8sClient) rather than paid
 * for on every startup.
 */

export interface PasswordStrength {
  score: 0 | 1 | 2 | 3 | 4;
  label: 'Very weak' | 'Weak' | 'Fair' | 'Strong' | 'Very strong';
  colorClassName: string;
}

const LABELS: PasswordStrength['label'][] = ['Very weak', 'Weak', 'Fair', 'Strong', 'Very strong'];
const COLORS = ['bg-red-500', 'bg-orange-500', 'bg-amber-500', 'bg-sky-500', 'bg-emerald-500'];

/** Minimum zxcvbn score ("Fair" or better) required before a master password can be submitted. */
export const MIN_ACCEPTABLE_SCORE = 2;

function toStrength(score: 0 | 1 | 2 | 3 | 4): PasswordStrength {
  return { score, label: LABELS[score], colorClassName: COLORS[score] };
}

let factoryPromise: Promise<import('@zxcvbn-ts/core').ZxcvbnFactory> | undefined;

function loadZxcvbn(): Promise<import('@zxcvbn-ts/core').ZxcvbnFactory> {
  if (!factoryPromise) {
    factoryPromise = Promise.all([
      import('@zxcvbn-ts/core'),
      import('@zxcvbn-ts/language-common'),
      import('@zxcvbn-ts/language-en'),
    ]).then(([core, common, en]) => {
      return new core.ZxcvbnFactory({
        dictionary: { ...common.dictionary, ...en.dictionary },
        graphs: common.adjacencyGraphs,
        translations: en.translations,
      });
    });
  }
  return factoryPromise;
}

/**
 * Resolves once zxcvbn-ts (and its dictionary data) has loaded and scored
 * the given password. Callers that can't await (e.g. mid-render) should use
 * this together with a fallback like estimatePasswordStrengthSync below —
 * treating "not loaded yet" as passing, never as failing, so a slow/failed
 * dynamic import can only ever be as strict as the old heuristic, never
 * block a password the user hasn't even had a chance to see scored.
 */
export async function estimatePasswordStrength(password: string): Promise<PasswordStrength> {
  if (!password) return toStrength(0);
  const factory = await loadZxcvbn();
  return toStrength(factory.check(password).score);
}
