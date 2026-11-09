import type { SyncConfigData } from './SyncConfigStore';
import type { ProfileSyncStatus } from '../../shared/types/sync';

/** What the status needs besides the saved config: live state that only the running app knows. */
export interface SyncStatusRuntime {
  topologyUnlocked: boolean;
  credentialsUnlocked: boolean;
  comparison: ProfileSyncStatus['comparison'];
  smartcardAvailable: boolean;
}

/**
 * Pure: the renderer-facing status of Remote Profile Sync, from the saved config plus live runtime state.
 * `ProfileSyncService` (what was compared) and `SyncConfigStore` (what is configured) stay separate; the
 * caller reads both and hands them in.
 */
export function toProfileSyncStatus(config: SyncConfigData, runtime: SyncStatusRuntime): ProfileSyncStatus {
  return {
    configured: !!config.target,
    target:
      config.target && (config.target.type === 'sftp' || config.target.type === 's3')
        ? { id: config.target.id, name: config.target.name, type: config.target.type }
        : undefined,
    targetConfig:
      config.target && (config.target.type === 'sftp' || config.target.type === 's3')
        ? {
            type: config.target.type,
            sftpConfig: config.target.sftpConfig,
            s3Config: config.target.s3Config,
          }
        : undefined,
    remoteBasePath: config.remoteBasePath,
    hasLocalSalts: !!(config.topologySaltBase64 && config.credentialsSaltBase64),
    topologyUnlocked: runtime.topologyUnlocked,
    credentialsUnlocked: runtime.credentialsUnlocked,
    lastSyncAt: config.lastSyncAt,
    comparison: runtime.comparison,
    autoSync: Boolean(config.autoSync),
    smartcardLinked: Boolean(config.smartcardSync),
    smartcardLibPath: config.smartcardSync?.pkcs11LibPath,
    smartcardAvailable: runtime.smartcardAvailable,
  };
}
