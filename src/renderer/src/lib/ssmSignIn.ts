import { AWS_SSO_EXPIRED_PREFIX } from '@shared/types/aws';
import type { SshSsmConfig } from '@shared/types/ssm';

const inflight = new Map<string, Promise<unknown>>();

/** Electron wraps main-process errors ("Error invoking remote method …: Error: <message>"), so match anywhere. */
export function isSsoExpiredError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  return message.includes(AWS_SSO_EXPIRED_PREFIX);
}

/** One sign-in per start URL at a time, so "Connect all" on several SSM servers shows a single dialog. */
export function signInOnce(startUrl: string, region: string, login: (u: string, r: string) => Promise<unknown>): Promise<unknown> {
  let p = inflight.get(startUrl);
  if (!p) {
    p = login(startUrl, region).finally(() => inflight.delete(startUrl));
    inflight.set(startUrl, p);
  }
  return p;
}

/**
 * Runs `create`; when it fails because the SSM profile's SSO session lapsed, signs in once and
 * retries exactly once. Any other error, or a profile without sshs3 SSO, is passed through.
 */
export async function withSsoRetry<T>(
  ssm: SshSsmConfig | undefined,
  create: () => Promise<T>,
  login: (startUrl: string, region: string) => Promise<unknown> = (u, r) => window.multissh.awsSsoLogin(u, r)
): Promise<T> {
  try {
    return await create();
  } catch (err) {
    if (!ssm?.sso || !isSsoExpiredError(err)) throw err;
    await signInOnce(ssm.sso.startUrl, ssm.sso.region, login);
    return create();
  }
}

/**
 * Terminal-create wrapper: returns `create()` untouched unless the profile uses sshs3 SSO, so every
 * other connection keeps its exact timing and shape.
 */
export function ssmRetry<T>(ssm: SshSsmConfig | undefined, create: () => Promise<T> | undefined): Promise<T> | undefined {
  if (!ssm?.sso) return create();
  return withSsoRetry(ssm, async () => (await create()) as T);
}
