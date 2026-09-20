import { describe, it, expect } from 'vitest';
import { formatSyncError } from '../../src/renderer/src/lib/syncErrors';

function ipcError(inner: string): Error {
  return new Error(`Error invoking remote method 'profile-sync:push': ${inner}`);
}

describe('formatSyncError', () => {
  it('strips the IPC wrapper and class name for a conflict error', () => {
    const result = formatSyncError(
      ipcError('SyncConflictError: Remote "topology" file changed since it was last read here. Pull the latest changes before pushing again.')
    );
    expect(result.kind).toBe('conflict');
    expect(result.message).toBe(
      'Remote "topology" file changed since it was last read here. Pull the latest changes before pushing again.'
    );
    expect(result.message).not.toContain('Error invoking remote method');
    expect(result.message).not.toContain('SyncConflictError');
  });

  it('recognizes a wrong master password / decryption failure', () => {
    const result = formatSyncError(ipcError('SyncDecryptionError: Wrong master password or corrupted sync file'));
    expect(result.kind).toBe('wrong-password');
    expect(result.message).toBe('Wrong master password or corrupted sync file');
  });

  it('falls back to a generic wrong-password message when SyncDecryptionError carries no message', () => {
    const result = formatSyncError(ipcError('SyncDecryptionError:'));
    expect(result.kind).toBe('wrong-password');
    expect(result.message.length).toBeGreaterThan(0);
  });

  it('recognizes a locked key group error', () => {
    const result = formatSyncError(
      ipcError('SyncLockedError: Sync key group "credentials" is locked; call unlock() first or supply a password to decrypt().')
    );
    expect(result.kind).toBe('locked');
  });

  it('classifies a smartcard signature verification failure', () => {
    const result = formatSyncError(
      new Error("Error invoking remote method 'profile-sync:unlock-smartcard': Error: Failed to verify cryptographic signature from smartcard. Please ensure the correct card is inserted.")
    );
    expect(result.kind).toBe('smartcard');
    expect(result.message).toContain('Failed to verify cryptographic signature');
  });

  it('gives a friendly message for a connection-refused network error', () => {
    const result = formatSyncError(
      new Error("Error invoking remote method 'profile-sync:push': Error: connect ECONNREFUSED 10.0.0.5:22")
    );
    expect(result.kind).toBe('network');
    expect(result.message).toMatch(/could not connect/i);
  });

  it('gives a friendly message for a DNS resolution failure', () => {
    const result = formatSyncError(new Error('Error: getaddrinfo ENOTFOUND sync.example.invalid'));
    expect(result.kind).toBe('network');
    expect(result.message).toMatch(/resolve/i);
  });

  it('uses the provided fallback for a non-Error value', () => {
    const result = formatSyncError(undefined, 'Push failed.');
    expect(result.message).toBe('Push failed.');
  });
});
