import { describe, it, expect } from 'vitest';
import { matchSavedSignIn, patchForSavedChoice, prefillFromSaved } from '../../src/renderer/src/lib/awsSavedSignIn';

const A = { id: 'a', name: 'Work', startUrl: 'https://d-aaa.awsapps.com/start', region: 'eu-west-1' };
const B = { id: 'b', name: 'Lab', startUrl: 'https://d-bbb.awsapps.com/start', region: 'us-east-1' };

describe('matchSavedSignIn', () => {
  it('finds the saved sign-in for the same URL and region, also when the URL has surrounding spaces or a pasted #/', () => {
    expect(matchSavedSignIn([A, B], { startUrl: A.startUrl, region: 'eu-west-1' })?.id).toBe('a');
    expect(matchSavedSignIn([A, B], { startUrl: ` ${A.startUrl}#/ `, region: ' eu-west-1 ' })?.id).toBe('a');
  });
  it('is undefined when nothing matches or only the region differs', () => {
    expect(matchSavedSignIn([A], { startUrl: A.startUrl, region: 'us-east-1' })).toBeUndefined();
    expect(matchSavedSignIn([A], { startUrl: '', region: 'eu-west-1' })).toBeUndefined();
  });
});

describe('prefillFromSaved', () => {
  it('uses the only saved sign-in for a form without a start URL', () => {
    expect(prefillFromSaved([A], { startUrl: '', region: 'us-east-1' })).toEqual({ startUrl: A.startUrl, region: 'eu-west-1' });
    expect(prefillFromSaved([A], { startUrl: '   ', region: 'us-east-1' })).not.toBeNull();
  });
  it('does nothing with none or several, or when the form already has a URL', () => {
    expect(prefillFromSaved([], { startUrl: '', region: 'us-east-1' })).toBeNull();
    expect(prefillFromSaved([A, B], { startUrl: '', region: 'us-east-1' })).toBeNull();
    expect(prefillFromSaved([A], { startUrl: 'https://d-own.awsapps.com/start', region: 'us-east-1' })).toBeNull();
  });
});

describe('patchForSavedChoice', () => {
  it('returns the URL and region and clears the account and role', () => {
    expect(patchForSavedChoice([A, B], { startUrl: A.startUrl, region: 'eu-west-1' }, 'b')).toEqual({ startUrl: B.startUrl, region: 'us-east-1', accountId: undefined, roleName: undefined });
  });
  it('changes nothing for Other…, an unknown id or the sign-in already shown', () => {
    expect(patchForSavedChoice([A, B], { startUrl: 'x', region: 'y' }, '')).toBeNull();
    expect(patchForSavedChoice([A, B], { startUrl: 'x', region: 'y' }, 'zzz')).toBeNull();
    expect(patchForSavedChoice([A, B], { startUrl: A.startUrl, region: 'eu-west-1' }, 'a')).toBeNull();
  });
});
