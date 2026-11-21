import { describe, it, expect } from 'vitest';
import { describeS3Error, isAwsSsoSessionError } from '../../src/main/aws/awsErrors';
import { AWS_SSO_CREDENTIALS_PREFIX, AWS_SSO_EXPIRED_PREFIX } from '../../src/shared/types/aws';

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
    const err = named('TokenProviderError', 'Token is expired');
    expect(describeS3Error(err, true).startsWith(AWS_SSO_EXPIRED_PREFIX)).toBe(true);
    expect(describeS3Error(err, false)).toBe('Token is expired');
  });

  it('explains access denied', () => {
    const msg = describeS3Error(named('AccessDenied', 'Access Denied'), true);
    expect(msg).toContain('Access denied');
    expect(msg).toContain('role');
  });
});

describe('awsErrors edge cases', () => {
  it('does not blame the session when the account or role is wrong', () => {
    const err = named('CredentialsProviderError', 'Could not resolve credentials using profile');
    expect(isAwsSsoSessionError(err)).toBe(false);
  });

  it('treats an ExpiredToken from AWS as an expired session', () => {
    expect(isAwsSsoSessionError(named('ExpiredToken', 'The provided token has expired.'))).toBe(true);
  });
});

describe('awsErrors wrapped errors', () => {
  it('finds an SSO failure in the cause chain', () => {
    const inner = named('TokenProviderError', 'Token is expired');
    const outer = new Error('request failed', { cause: inner });
    expect(isAwsSsoSessionError(outer)).toBe(true);
    expect(isAwsSsoSessionError(new Error('request failed', { cause: new Error('socket hang up') }))).toBe(false);
  });
});

describe('awsErrors credentials failures', () => {
  it('offers a sign-in, keeping the cause, when credentials cannot be resolved for another reason', () => {
    const err = named('CredentialsProviderError', 'Error: Proxy connection error (p:3128): connect ECONNREFUSED');
    const msg = describeS3Error(err, true);
    expect(msg.startsWith(AWS_SSO_CREDENTIALS_PREFIX)).toBe(true);
    expect(msg).toContain('Proxy connection error');
    expect(describeS3Error(new Error(msg, { cause: err }), true)).toBe(msg);
    expect(describeS3Error(err, false)).toBe(err.message);
  });

  it("names the bucket's region when a request went to the wrong one (301 with x-amz-bucket-region)", () => {
    const redirect = Object.assign(named('PermanentRedirect', 'The bucket you are attempting to access must be addressed using the specified endpoint.'), {
      $metadata: { httpStatusCode: 301 },
      $response: { headers: { 'x-amz-bucket-region': 'eu-north-1' } },
    });
    expect(describeS3Error(redirect, true)).toBe('This bucket is in the region eu-north-1, but this profile uses another region. Edit the profile and set Region to eu-north-1.');
    // HeadBucket (the connection test) has no body, so the SDK reports an unnamed 301.
    const head = Object.assign(named('UnknownError', 'UnknownError'), { $metadata: { httpStatusCode: 301 }, $response: { headers: { 'x-amz-bucket-region': 'eu-north-1' } } });
    expect(describeS3Error(head, false)).toContain('set Region to eu-north-1');
  });

  it('does not trust a region header that is not a region name, and leaves other 301s alone', () => {
    const odd = Object.assign(named('PermanentRedirect', 'must be addressed using the specified endpoint'), {
      $metadata: { httpStatusCode: 301 },
      $response: { headers: { 'x-amz-bucket-region': 'x"; rm -rf /' } },
    });
    expect(describeS3Error(odd, false)).toBe('must be addressed using the specified endpoint');
    expect(describeS3Error(Object.assign(named('PermanentRedirect', 'moved'), { $metadata: { httpStatusCode: 301 } }), false)).toBe('moved');
  });
});
