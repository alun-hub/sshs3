import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

/**
 * Guards the Electron upgrade, not our code.
 *
 * `src/main/crypto/SecretFieldCrypto.ts` calls the synchronous safeStorage methods
 * (`isEncryptionAvailable`, `encryptString`, `decryptString`). Electron 45 deprecates them and
 * Electron 46 removes them. Every test that touches secrets mocks `safeStorage`, so nothing else
 * would notice: with the methods gone `isEncryptionAvailable()` returns false and new secrets are
 * stored as plaintext while old ones read back as empty.
 *
 * This reads the installed Electron's own type declarations, so it fails the moment a version
 * without the synchronous methods is installed, in `npm test`, pre-commit and CI alike.
 */
const SYNC_METHODS = ['isEncryptionAvailable', 'encryptString', 'decryptString'];
const ASYNC_METHODS = ['isAsyncEncryptionAvailable', 'encryptStringAsync', 'decryptStringAsync'];

function safeStorageDeclaration(): string {
  const require = createRequire(import.meta.url);
  const electronDir = path.dirname(require.resolve('electron/package.json'));
  const typings = fs.readFileSync(path.join(electronDir, 'electron.d.ts'), 'utf8');
  const match = /interface SafeStorage \{([\s\S]*?)\n {2}\}/.exec(typings);
  if (!match) throw new Error('Could not find `interface SafeStorage` in electron.d.ts; update this test');
  return match[1];
}

function declares(body: string, method: string): boolean {
  return new RegExp(`^\\s+${method}\\(`, 'm').test(body);
}

describe('Electron safeStorage API', () => {
  const body = safeStorageDeclaration();

  it('still has the synchronous methods SecretFieldCrypto uses', () => {
    const missing = SYNC_METHODS.filter((method) => !declares(body, method));
    expect(
      missing,
      `Electron removed safeStorage.${missing.join(', safeStorage.')}. Migrate src/main/crypto/SecretFieldCrypto.ts ` +
        'to encryptStringAsync/decryptStringAsync/isAsyncEncryptionAvailable before upgrading; otherwise new ' +
        'secrets are stored as plaintext and saved ones read back as empty (tests mock safeStorage, so nothing else fails).'
    ).toEqual([]);
  });

  it('offers the asynchronous methods the migration will move to', () => {
    const missing = ASYNC_METHODS.filter((method) => !declares(body, method));
    expect(missing, `Electron no longer declares safeStorage.${missing.join(', safeStorage.')}; revisit the migration plan`).toEqual([]);
  });
});
