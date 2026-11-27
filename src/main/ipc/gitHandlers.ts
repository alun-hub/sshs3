import { fetchGitPublicKeys } from '../git/GitKeyFetcher';
import { GitConfigService } from '../git/GitConfigService';
import { GitStatusService } from '../git/GitStatusService';
import { RemoteGitService, type RemoteGitConnection } from '../git/RemoteGitService';
import { DotfileGitImporter } from '../dotfiles/DotfileGitImporter';
import { classifyAskpassPrompt } from '../ssh/askpassPrompt';
import { SFTPStorageProvider } from '../storage/SFTPStorageProvider';
import type { ConfigureGitSigningRequest, ConfigureGitSigningResult, DotfilesImportFromGitRequest, DotfilesImportFromGitResult, FetchGitKeysRequest, FetchGitKeysResult, GitCloneRequest, GitOperationResult, GitRepoStatus, GitSigningConfig, TestRemoteGitAccessRequest, TestRemoteGitAccessResult } from '../../shared/types/git';
import { IPC_CHANNELS } from '../../shared/types/ipc';
import type { SSHConnectionConfig } from '../../shared/types/ssh';
import type { IpcBridge } from '../IpcBridge';
import type { SmartcardCoordinator } from '../smartcard/SmartcardCoordinator';
import { isFeatureAllowed } from '../policy/policyApply';

const DISABLED_BY_POLICY = 'Disabled by your administrator.';

/** The part of IpcBridge this handler group may use. */
export type GitHost = Pick<
  IpcBridge,
  'dotfilePoolStore' | 'makePresenceNotifier' | 'policy' | 'profileStore' | 'promptForPinDirect' | 'promptHostKeyTrust' | 'registerHandler' | 'resolveProxyJumpConfig' | 'restoreSavedSecrets' | 'scheduleAutoSync' | 'storageRegistry'
> & {
  smartcard: Pick<SmartcardCoordinator, 'prepareSshCaConfig'>;
};

export function registerGitHandlers(bridge: GitHost): void {
  /** A connection for Git's own ssh commands: saved secrets, the jump host and, as for a terminal, the SSH CA session. */
  const prepareSshConfig = async (config: SSHConnectionConfig): Promise<SSHConnectionConfig> => {
    const withSecrets = await bridge.restoreSavedSecrets(config);
    return bridge.smartcard.prepareSshCaConfig(await bridge.resolveProxyJumpConfig(withSecrets));
  };

  /** The connection an open SFTP pane already has (agent, certificate, jump host and secrets resolved), with its prompts. */
  const paneConnection = (provider: SFTPStorageProvider): RemoteGitConnection => {
    const config = provider.getConnectionConfig() as SSHConnectionConfig;
    const label = config.name || config.host;
    const presence = bridge.makePresenceNotifier(undefined, `Touch your security key to clone on ${label}`);
    return {
      config,
      prompts: {
        pinPromptHandler: (prompt) =>
          bridge.promptForPinDirect(prompt.trim(), classifyAskpassPrompt(prompt.trim(), config.authType), `SSH: ${label}`),
        hostKeyPromptHandler: (info) => bridge.promptHostKeyTrust(info),
        onPresence: presence.onPresenceRequested,
        onPresenceCleared: presence.onPresenceCleared,
      },
    };
  };

  bridge.registerHandler(
    IPC_CHANNELS.GIT_FETCH_PUBLIC_KEYS,
    async (_event, request: FetchGitKeysRequest): Promise<FetchGitKeysResult> => {
      if (!isFeatureAllowed(bridge.policy.policy, 'gitKeyFetch')) {
        return { success: false, keys: [], error: DISABLED_BY_POLICY };
      }
      return await fetchGitPublicKeys(request);
    }
  );

  bridge.registerHandler(
    IPC_CHANNELS.GIT_GET_SIGNING_CONFIG,
    async (): Promise<GitSigningConfig> => {
      return await GitConfigService.getSigningConfig();
    }
  );

  bridge.registerHandler(
    IPC_CHANNELS.GIT_CONFIGURE_SIGNING,
    async (_event, request: ConfigureGitSigningRequest): Promise<ConfigureGitSigningResult> => {
      return await GitConfigService.configureSigning(request);
    }
  );

  bridge.registerHandler(
    IPC_CHANNELS.GIT_SET_SIGNING_ENABLED,
    async (_event, enabled: boolean): Promise<ConfigureGitSigningResult> => {
      return await GitConfigService.setSigningEnabled(Boolean(enabled));
    }
  );

  bridge.registerHandler(
    IPC_CHANNELS.GIT_GET_STATUS,
    async (_event, directoryPath: string, providerId?: string): Promise<GitRepoStatus> => {
      return await GitStatusService.getStatus(directoryPath, providerId, bridge.storageRegistry);
    }
  );

  bridge.registerHandler(
    IPC_CHANNELS.GIT_CLONE,
    async (_event, request: GitCloneRequest): Promise<GitOperationResult> => {
      if (!request.providerId || request.providerId === 'local') {
        return await RemoteGitService.clone(request);
      }
      // Only the id comes from the renderer; the connection is the one that pane is already using.
      const provider = bridge.storageRegistry.get(request.providerId);
      if (!(provider instanceof SFTPStorageProvider)) {
        return { success: false, error: 'Git clone on a server needs an open SFTP connection. Reconnect the pane and try again.' };
      }
      // The pane's path may be relative to the home folder, which a quoted `cd` would take literally.
      const targetDirectory =
        typeof request.targetDirectory === 'string' && request.targetDirectory.trim()
          ? await provider.resolveRemotePath(request.targetDirectory)
          : '';
      return await RemoteGitService.clone({ ...request, targetDirectory }, paneConnection(provider));
    }
  );

  bridge.registerHandler(
    IPC_CHANNELS.GIT_PULL,
    async (_event, directoryPath: string, providerId?: string): Promise<GitOperationResult> => {
      // Remote panes are identified by `sftp-<profileId>`. The connection is resolved from the saved
      // profile here, never taken from the renderer.
      let sftpConfig: SSHConnectionConfig | undefined;
      if (providerId && providerId !== 'local') {
        const profileId = providerId.startsWith('sftp-') ? providerId.slice('sftp-'.length) : undefined;
        const profile = profileId
          ? (await bridge.profileStore.getProfiles()).ssh.find((p) => p.id === profileId)
          : undefined;
        if (profile) {
          sftpConfig = await prepareSshConfig(profile);
        }
      }
      return await RemoteGitService.pull(directoryPath, providerId, sftpConfig);
    }
  );

  bridge.registerHandler(
    IPC_CHANNELS.GIT_TEST_REMOTE_ACCESS,
    async (_event, request: TestRemoteGitAccessRequest): Promise<TestRemoteGitAccessResult> => {
      return await RemoteGitService.testRemoteAccess({ ...request, config: await prepareSshConfig(request.config) });
    }
  );

  bridge.registerHandler(
    IPC_CHANNELS.DOTFILES_IMPORT_FROM_GIT,
    async (_event, request: DotfilesImportFromGitRequest): Promise<DotfilesImportFromGitResult> => {
      if (!isFeatureAllowed(bridge.policy.policy, 'dotfileGitImport')) {
        return { success: false, error: DISABLED_BY_POLICY };
      }
      const res = await DotfileGitImporter.importFromGit(request, bridge.dotfilePoolStore);
      if (res.success) {
        bridge.scheduleAutoSync();
      }
      return res;
    }
  );
}
