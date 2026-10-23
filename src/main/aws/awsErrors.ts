import { AWS_SSO_EXPIRED_PREFIX } from '../../shared/types/aws';

// Unambiguous: the SSO token provider failing, the portal rejecting the token, or AWS saying it lapsed.
const SSO_ERROR_NAMES = new Set(['TokenProviderError', 'UnauthorizedException', 'ExpiredToken', 'ExpiredTokenException']);
const SSO_ERROR_PATTERN =
  /sso session|sso login|sso token|token is expired|session token not found|refresh token|cached sso|token has expired/i;

/**
 * True when `err` means the SSO sign-in behind an S3 profile is missing, expired or rejected.
 * `CredentialsProviderError` alone is not enough: it also covers a wrong account or role, which a
 * new sign-in does not fix.
 */
export function isAwsSsoSessionError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (SSO_ERROR_NAMES.has(err.name)) return true;
  return SSO_ERROR_PATTERN.test(err.message);
}

/** Message shown in the file pane for a failed S3 call; keeps SSO expiry distinguishable from a permission error. */
export function describeS3Error(err: unknown, ssoProfile: boolean): string {
  if (ssoProfile && isAwsSsoSessionError(err)) {
    return `${AWS_SSO_EXPIRED_PREFIX}: sign in again to continue.`;
  }
  if (err instanceof Error) {
    const code = err.name && err.name !== 'Error' ? err.name : '';
    const text = err.message || code;
    if (code === 'AccessDenied' || code === 'AccessDeniedException' || code === 'Forbidden') {
      return `Access denied: ${text}. The signed-in role is not allowed to do this.`;
    }
    return text || 'S3 request failed';
  }
  return String(err);
}
