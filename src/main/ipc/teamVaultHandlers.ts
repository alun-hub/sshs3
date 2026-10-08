import { IPC_CHANNELS } from '../../shared/types/ipc';
import type { TeamVaultRole } from '../../shared/types/teamVault';
import type { IpcBridge } from '../IpcBridge';

/** The part of IpcBridge this handler group may use. */
export type TeamVaultHost = Pick<IpcBridge, 'registerHandler' | 'teamVaultService'>;

export function registerTeamVaultHandlers(bridge: TeamVaultHost): void {
  bridge.registerHandler(IPC_CHANNELS.TEAM_VAULT_GET_STATUS, async () => {
    return bridge.teamVaultService.getStatus();
  });

  bridge.registerHandler(IPC_CHANNELS.TEAM_VAULT_ENROLL_RECIPIENT, async () => {
    return bridge.teamVaultService.enrollOwnPivRecipient();
  });

  bridge.registerHandler(
    IPC_CHANNELS.TEAM_VAULT_CREATE,
    async (_event, selfRecipientId: string, selfAgeRecipient: string) => {
      if (!selfRecipientId?.trim() || !selfAgeRecipient?.trim()) {
        throw new Error('A recipient id and age recipient string are required to create a vault');
      }
      return bridge.teamVaultService.createVault(selfRecipientId, selfAgeRecipient);
    }
  );

  bridge.registerHandler(
    IPC_CHANNELS.TEAM_VAULT_ADD_MEMBER,
    async (_event, recipientId: string, ageRecipient: string, role: TeamVaultRole, addedBy: string) => {
      if (!recipientId?.trim() || !ageRecipient?.trim()) {
        throw new Error('A recipient id and age recipient string are required to add a member');
      }
      if (role !== 'admin' && role !== 'member') {
        throw new Error(`Invalid role "${role}"`);
      }
      await bridge.teamVaultService.addMember(recipientId, ageRecipient, role, addedBy);
    }
  );

  bridge.registerHandler(
    IPC_CHANNELS.TEAM_VAULT_REMOVE_MEMBER,
    async (_event, recipientId: string, removedBy: string) => {
      return bridge.teamVaultService.removeMember(recipientId, removedBy);
    }
  );

  bridge.registerHandler(
    IPC_CHANNELS.TEAM_VAULT_SET_ROLE,
    async (_event, recipientId: string, role: TeamVaultRole, updatedBy: string) => {
      if (role !== 'admin' && role !== 'member') {
        throw new Error(`Invalid role "${role}"`);
      }
      await bridge.teamVaultService.setRole(recipientId, role, updatedBy);
    }
  );

  bridge.registerHandler(
    IPC_CHANNELS.TEAM_VAULT_UNLOCK,
    async (_event, recipientId: string, identityFilePath: string) => {
      await bridge.teamVaultService.unlock(recipientId, identityFilePath);
    }
  );

  bridge.registerHandler(IPC_CHANNELS.TEAM_VAULT_LOCK, async () => {
    bridge.teamVaultService.lock();
  });
}
