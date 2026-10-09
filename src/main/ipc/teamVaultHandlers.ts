import path from 'node:path';
import { IPC_CHANNELS, type StorageConnectConfig } from '../../shared/types/ipc';
import type { TeamVaultRole, TeamVaultStatus } from '../../shared/types/teamVault';
import type { IpcBridge } from '../IpcBridge';
import { readSmartcardCertificates } from '../smartcard/SmartcardCertificateReader';
import { createLogger } from '../log';

const teamVaultLog = createLogger('team-vault');

/** The part of IpcBridge this handler group may use. */
export type TeamVaultHost = Pick<
  IpcBridge,
  | 'buildTeamVaultStatus'
  | 'registerHandler'
  | 'storageRegistry'
  | 'syncConfigStore'
  | 'teamVaultConfigStore'
  | 'teamVaultService'
>;

/** Best-effort only — reads whatever authentication-capable smartcard certificate is already
 * configured for Remote Profile Sync (same `smartcardSync.pkcs11LibPath` as
 * `IpcBridge.unlockWithSmartcardInternal`, no new setting needed) and suggests its UPN as a
 * default recipient-id label, purely to save the admin from inventing their own. No PIN prompt —
 * `readSmartcardCertificates` never logs in (public cert objects). Never throws: a missing/absent
 * card, an unconfigured path, or any read error just means no suggestion, not a failed enroll. */
async function suggestLabelFromSmartcard(bridge: TeamVaultHost): Promise<string | undefined> {
  try {
    const pkcs11LibPath = (await bridge.syncConfigStore.getConfig()).smartcardSync?.pkcs11LibPath;
    if (!pkcs11LibPath) return undefined;
    const certs = await readSmartcardCertificates(pkcs11LibPath);
    for (const details of certs.values()) {
      if (details.authCapable && details.upn) return details.upn;
    }
    return undefined;
  } catch (err) {
    teamVaultLog.warn('failed to suggest a label from the smartcard certificate (non-fatal):', err);
    return undefined;
  }
}

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
    const result = await bridge.teamVaultService.enrollOwnPivRecipient();
    // Neither value is a secret (see TeamVaultConfigStore.setSelfIdentity's doc comment) — saved
    // purely so the unlock form can prefill itself instead of making the admin retype/relocate
    // these every session (found via end-to-end testing, see docs/team-vault-plan.md).
    await bridge.teamVaultConfigStore.setSelfIdentity(undefined, result.identityFilePath);
    const suggestedLabel = await suggestLabelFromSmartcard(bridge);
    return { ...result, suggestedLabel };
  });

  bridge.registerHandler(
    IPC_CHANNELS.TEAM_VAULT_CREATE,
    async (_event, selfRecipientId: string, selfAgeRecipient: string) => {
      requireRecipientId(selfRecipientId, 'Recipient id');
      requireAgeRecipient(selfAgeRecipient, 'Age recipient');
      const result = await bridge.teamVaultService.createVault(selfRecipientId, selfAgeRecipient);
      await bridge.teamVaultConfigStore.setSelfIdentity(selfRecipientId, undefined);
      return result;
    }
  );

  bridge.registerHandler(
    IPC_CHANNELS.TEAM_VAULT_ADD_MEMBER,
    async (_event, recipientId: string, ageRecipient: string, role: TeamVaultRole) => {
      requireRecipientId(recipientId, 'Recipient id');
      requireAgeRecipient(ageRecipient, 'Age recipient');
      requireRole(role);
      await bridge.teamVaultService.addMember(recipientId, ageRecipient, role);
    }
  );

  bridge.registerHandler(IPC_CHANNELS.TEAM_VAULT_REMOVE_MEMBER, async (_event, recipientId: string) => {
    requireRecipientId(recipientId, 'Recipient id');
    return bridge.teamVaultService.removeMember(recipientId);
  });

  bridge.registerHandler(
    IPC_CHANNELS.TEAM_VAULT_SET_ROLE,
    async (_event, recipientId: string, role: TeamVaultRole) => {
      requireRecipientId(recipientId, 'Recipient id');
      requireRole(role);
      await bridge.teamVaultService.setRole(recipientId, role);
    }
  );

  bridge.registerHandler(
    IPC_CHANNELS.TEAM_VAULT_UNLOCK,
    async (_event, recipientId: string, identityFilePath: string) => {
      requireRecipientId(recipientId, 'Recipient id');
      requireIdentityFilePath(identityFilePath);
      await bridge.teamVaultService.unlock(recipientId, identityFilePath);
      await bridge.teamVaultConfigStore.setSelfIdentity(recipientId, identityFilePath);
    }
  );

  bridge.registerHandler(IPC_CHANNELS.TEAM_VAULT_LOCK, async () => {
    bridge.teamVaultService.lock();
  });

  bridge.registerHandler(IPC_CHANNELS.TEAM_VAULT_DELETE, async () => {
    await bridge.teamVaultService.deleteVault();
    await bridge.teamVaultConfigStore.clearSelfIdentity();
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
