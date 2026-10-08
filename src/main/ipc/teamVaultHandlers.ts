import path from 'node:path';
import { IPC_CHANNELS, type StorageConnectConfig } from '../../shared/types/ipc';
import type { TeamVaultRole, TeamVaultStatus } from '../../shared/types/teamVault';
import type { IpcBridge } from '../IpcBridge';

/** The part of IpcBridge this handler group may use. */
export type TeamVaultHost = Pick<
  IpcBridge,
  'buildTeamVaultStatus' | 'registerHandler' | 'storageRegistry' | 'teamVaultConfigStore' | 'teamVaultService'
>;

// `age`'s own recipient encoding (bech32: lowercase letters + digits only) — also doubles as an
// argument-injection guard, since nothing matching this can start with '-' or contain shell/CLI
// metacharacters.
const AGE_RECIPIENT_PATTERN = /^age1[a-z0-9]{20,}$/;

function requireAgeRecipient(value: string, label: string): void {
  if (typeof value !== 'string' || !AGE_RECIPIENT_PATTERN.test(value)) {
    throw new Error(`${label} must be a valid age recipient string (age1...)`);
  }
}

function requireRecipientId(value: string, label: string): void {
  if (typeof value !== 'string' || !value.trim() || value.length > 512) {
    throw new Error(`${label} is required`);
  }
}

function requireRole(role: TeamVaultRole): void {
  if (role !== 'admin' && role !== 'member') {
    throw new Error(`Invalid role "${role}"`);
  }
}

/** The identity file is a path the user themselves typed/picked (their own card's identity
 * stanza, or the recovery identity they saved) — unlike a credential, rejecting it outright would
 * defeat the feature, so this only guards against it being mistaken for a CLI flag by `age`
 * (defense in depth; `TeamVaultCryptoService` enforces the same check at the actual exec site). */
function requireIdentityFilePath(value: string): void {
  if (typeof value !== 'string' || !value.trim() || !path.isAbsolute(value) || value.startsWith('-')) {
    throw new Error('Identity file path must be an absolute path');
  }
}

export function registerTeamVaultHandlers(bridge: TeamVaultHost): void {
  bridge.registerHandler(IPC_CHANNELS.TEAM_VAULT_GET_STATUS, async (): Promise<TeamVaultStatus> => {
    return bridge.buildTeamVaultStatus();
  });

  bridge.registerHandler(IPC_CHANNELS.TEAM_VAULT_ENROLL_RECIPIENT, async () => {
    return bridge.teamVaultService.enrollOwnPivRecipient();
  });

  bridge.registerHandler(
    IPC_CHANNELS.TEAM_VAULT_CREATE,
    async (_event, selfRecipientId: string, selfAgeRecipient: string) => {
      requireRecipientId(selfRecipientId, 'Recipient id');
      requireAgeRecipient(selfAgeRecipient, 'Age recipient');
      return bridge.teamVaultService.createVault(selfRecipientId, selfAgeRecipient);
    }
  );

  bridge.registerHandler(
    IPC_CHANNELS.TEAM_VAULT_ADD_MEMBER,
    async (_event, recipientId: string, ageRecipient: string, role: TeamVaultRole, addedBy: string) => {
      requireRecipientId(recipientId, 'Recipient id');
      requireAgeRecipient(ageRecipient, 'Age recipient');
      requireRole(role);
      requireRecipientId(addedBy, 'Added-by recipient id');
      await bridge.teamVaultService.addMember(recipientId, ageRecipient, role, addedBy);
    }
  );

  bridge.registerHandler(
    IPC_CHANNELS.TEAM_VAULT_REMOVE_MEMBER,
    async (_event, recipientId: string, removedBy: string) => {
      requireRecipientId(recipientId, 'Recipient id');
      requireRecipientId(removedBy, 'Removed-by recipient id');
      return bridge.teamVaultService.removeMember(recipientId, removedBy);
    }
  );

  bridge.registerHandler(
    IPC_CHANNELS.TEAM_VAULT_SET_ROLE,
    async (_event, recipientId: string, role: TeamVaultRole, updatedBy: string) => {
      requireRecipientId(recipientId, 'Recipient id');
      requireRole(role);
      requireRecipientId(updatedBy, 'Updated-by recipient id');
      await bridge.teamVaultService.setRole(recipientId, role, updatedBy);
    }
  );

  bridge.registerHandler(
    IPC_CHANNELS.TEAM_VAULT_UNLOCK,
    async (_event, recipientId: string, identityFilePath: string) => {
      requireRecipientId(recipientId, 'Recipient id');
      requireIdentityFilePath(identityFilePath);
      await bridge.teamVaultService.unlock(recipientId, identityFilePath);
    }
  );

  bridge.registerHandler(IPC_CHANNELS.TEAM_VAULT_LOCK, async () => {
    bridge.teamVaultService.lock();
  });

  bridge.registerHandler(
    IPC_CHANNELS.TEAM_VAULT_SET_TARGET,
    async (_event, target: StorageConnectConfig, remoteBasePath?: string) => {
      if (!target || !target.id || !target.name) {
        throw new Error('A Team Vault target with an id and name is required');
      }
      if (target.type !== 's3') {
        throw new Error('The Team Vault only supports an S3-compatible target');
      }
      if (!remoteBasePath?.trim()) {
        throw new Error('An S3 target requires a bucket (optionally "bucket/prefix") to sync to');
      }
      await bridge.teamVaultConfigStore.setTarget(target, remoteBasePath);
      await bridge.storageRegistry.disconnect?.(target.id);
      // The (app-lifetime) TeamVaultService instance otherwise keeps comparing against whatever
      // remote state it last observed on the *previous* target — same reasoning as
      // ProfileSyncService.resetRemoteState() in syncHandlers.ts.
      bridge.teamVaultService.resetRemoteState();
    }
  );

  bridge.registerHandler(IPC_CHANNELS.TEAM_VAULT_PUSH, async (): Promise<TeamVaultStatus> => {
    const config = await bridge.teamVaultConfigStore.getConfig();
    if (!config.target) {
      throw new Error('Configure a Team Vault target first (team-vault:set-target)');
    }
    const provider = await bridge.storageRegistry.getOrCreate(config.target);
    await bridge.teamVaultService.pushToRemote(provider, config.remoteBasePath ?? '');
    await bridge.teamVaultConfigStore.setLastSyncAt(new Date().toISOString());
    return bridge.buildTeamVaultStatus();
  });

  bridge.registerHandler(IPC_CHANNELS.TEAM_VAULT_PULL, async (): Promise<TeamVaultStatus> => {
    const config = await bridge.teamVaultConfigStore.getConfig();
    if (!config.target) {
      throw new Error('Configure a Team Vault target first (team-vault:set-target)');
    }
    const provider = await bridge.storageRegistry.getOrCreate(config.target);
    await bridge.teamVaultService.pullFromRemote(provider, config.remoteBasePath ?? '');
    await bridge.teamVaultConfigStore.setLastSyncAt(new Date().toISOString());
    return bridge.buildTeamVaultStatus();
  });

  bridge.registerHandler(IPC_CHANNELS.TEAM_VAULT_HAS_REMOTE_VAULT, async (): Promise<boolean> => {
    const config = await bridge.teamVaultConfigStore.getConfig();
    if (!config.target) return false;
    const provider = await bridge.storageRegistry.getOrCreate(config.target);
    return bridge.teamVaultService.hasRemoteVault(provider, config.remoteBasePath ?? '');
  });
}
