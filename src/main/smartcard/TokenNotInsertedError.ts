/** The user dismissed the "insert your token" prompt: the connection must stop, not fall back to another PIN prompt. */
export class TokenNotInsertedError extends Error {
  constructor(kind: 'smartcard' | 'fido2') {
    super(kind === 'fido2' ? 'No security key inserted' : 'No smartcard inserted');
    this.name = 'TokenNotInsertedError';
  }
}
