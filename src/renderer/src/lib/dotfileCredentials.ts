// LOW finding (code review): pooled dotfile content is always stored as
// plaintext on disk — an intentional tradeoff (these are config files
// pushed to remote hosts as-is, not secrets our own app ever decrypts for
// its own use), but a handful of well-known dotfiles exist specifically to
// hold credentials. Warn rather than silently store those unencrypted too.
const CREDENTIAL_DOTFILE_BASENAMES = new Set([
  '.netrc',
  '.pgpass',
  '.npmrc',
  '.git-credentials',
  'credentials', // e.g. ~/.aws/credentials
  'config.json', // e.g. ~/.docker/config.json
  'kubeconfig',
]);

// kube configs embed cluster tokens/certs.
const CREDENTIAL_DOTFILE_PATHS = ['/.kube/config'];

export function looksLikeCredentialFile(remotePath: string): boolean {
  const basename = remotePath.split('/').pop() ?? remotePath;
  return CREDENTIAL_DOTFILE_BASENAMES.has(basename) || CREDENTIAL_DOTFILE_PATHS.some((p) => remotePath.endsWith(p));
}

