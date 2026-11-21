import { normalizeStartUrl } from '@shared/ssm';
import type { AwsSignIn } from '@shared/types/aws';

/** What a form knows about its IAM Identity Center sign-in. */
export interface SignInFields {
  startUrl: string;
  region: string;
}

/** The saved sign-in that a form's start URL and region stand for, compared normalised, or undefined ("Other…"). */
export function matchSavedSignIn(saved: readonly AwsSignIn[], value: SignInFields): AwsSignIn | undefined {
  const url = normalizeStartUrl(value.startUrl);
  const region = value.region.trim();
  return saved.find((s) => normalizeStartUrl(s.startUrl) === url && s.region === region);
}

/**
 * What a new form starts from: the only saved sign-in. Nothing when there is none or several (the user chooses), and nothing
 * when the form already has a start URL (a profile is never changed behind the user's back).
 */
export function prefillFromSaved(saved: readonly AwsSignIn[], value: SignInFields): SignInFields | null {
  if (saved.length !== 1 || value.startUrl.trim()) return null;
  return { startUrl: saved[0].startUrl, region: saved[0].region };
}

/** The change when the user picks a saved sign-in: the new URL and region, and the account and role of the old one cleared. */
export function patchForSavedChoice(
  saved: readonly AwsSignIn[],
  value: SignInFields,
  id: string,
): (SignInFields & { accountId: undefined; roleName: undefined }) | null {
  const pick = saved.find((s) => s.id === id);
  if (!pick || matchSavedSignIn(saved, value)?.id === id) return null; // "Other…" keeps what is typed
  return { startUrl: pick.startUrl, region: pick.region, accountId: undefined, roleName: undefined };
}
