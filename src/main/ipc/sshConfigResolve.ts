import type { SSHConnectionConfig } from '../../shared/types/ssh';
import type { IpcBridge } from '../IpcBridge';

/** What `resolveSshConfigForConnect` needs from the bridge. */
export type SshConfigResolveHost = Pick<IpcBridge, 'restoreSavedSecrets' | 'teamVaultService'>;

/**
 * Turns the connection config the renderer sent into the one main actually connects with: a Team Vault
 * shared profile is looked up by its reference, and a saved password or key passphrase is restored.
 * The renderer's own copy may have had both stripped (a Team Vault member never receives the real
 * secrets, and the secrets of saved profiles never leave main), so every way of opening an SSH
 * connection — terminal, tunnel — has to resolve them here rather than trust `config.password`.
 */
export async function resolveSshConfigForConnect(
  bridge: SshConfigResolveHost,
  config: SSHConnectionConfig
): Promise<SSHConnectionConfig> {
  let resolved = config;
  if (resolved.teamVaultProfileRef) {
    const shared = await bridge.teamVaultService.resolveProfileForConnect(
      resolved.teamVaultProfileRef.vaultId,
      'ssh',
      resolved.teamVaultProfileRef.profileId
    );
    resolved = { ...(shared as SSHConnectionConfig), id: resolved.id };
  }
  return bridge.restoreSavedSecrets(resolved);
}
