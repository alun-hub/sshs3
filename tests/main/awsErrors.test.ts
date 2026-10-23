import { describe, it, expect } from 'vitest';
import { describeS3Error, isAwsSsoSessionError } from '../../src/main/aws/awsErrors';
import { AWS_SSO_EXPIRED_PREFIX } from '../../src/shared/types/aws';

function named(name: string, message: string): Error {
  const err = new Error(message);
  err.name = name;
  return err;
}

describe('awsErrors', () => {
  it('recognises an expired SSO session', () => {
    expect(isAwsSsoSessionError(named('TokenProviderError', 'x'))).toBe(true);
    expect(isAwsSsoSessionError(new Error('The SSO session associated with this profile has expired'))).toBe(true);
    expect(isAwsSsoSessionError(named('AccessDenied', 'Access Denied'))).toBe(false);
    expect(isAwsSsoSessionError('nope')).toBe(false);
  });

  it('asks for a new sign-in only for SSO profiles', () => {
    const err = named('CredentialsProviderError', 'Token is expired');
    expect(describeS3Error(err, true).startsWith(AWS_SSO_EXPIRED_PREFIX)).toBe(true);
    expect(describeS3Error(err, false)).toBe('Token is expired');
  });

  it('explains access denied', () => {
    const msg = describeS3Error(named('AccessDenied', 'Access Denied'), true);
    expect(msg).toContain('Access denied');
    expect(msg).toContain('role');
  });
});
