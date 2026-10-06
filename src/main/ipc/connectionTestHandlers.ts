import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { ListBucketsCommand } from '@aws-sdk/client-s3';
import { SmartcardDetector } from '../smartcard/SmartcardDetector';
import { SFTPStorageProvider } from '../storage/SFTPStorageProvider';
import { S3StorageProvider } from '../storage/S3StorageProvider';
import { createHostVerifier } from '../ssh/HostKeyVerifier';
import { IPC_CHANNELS } from '../../shared/types/ipc';
import type { SSHConnectionConfig } from '../../shared/types/ssh';
import type { S3Config } from '../../shared/types/storage';
import type { IpcBridge } from '../IpcBridge';

/** The part of IpcBridge this handler group may use. */
export type ConnectionTestHost = Pick<IpcBridge, 'promptHostKeyTrust' | 'registerHandler'>;

export function registerConnectionTestHandlers(bridge: ConnectionTestHost): void {
  bridge.registerHandler(
    IPC_CHANNELS.CONNECTION_TEST_SSH,
    async (_event, config: SSHConnectionConfig): Promise<{ success: boolean; error?: string }> => {
      if (!config || !config.host?.trim()) {
        return { success: false, error: 'Hostname / IP is required' };
      }
      if (!config.username?.trim()) {
        return { success: false, error: 'Username is required' };
      }

      if (config.authType === 'smartcard') {
        if (!config.pkcs11LibPath?.trim()) {
          return { success: false, error: 'PKCS#11 library path is required' };
        }
        const valid = await SmartcardDetector.validateLibraryPath(config.pkcs11LibPath);
        if (!valid) {
          return { success: false, error: `Smartcard library not found: ${config.pkcs11LibPath}` };
        }
        return { success: true };
      }

      // Like 'smartcard' above, a live connection test is skipped: a real attempt would need
      // a physical touch (and possibly the resident agent-load dance) that doesn't fit a quick
      // "Test Connection" click. Only the config shape is validated here.
      if (config.authType === 'fido2') {
        if (config.fido2Resident) {
          return { success: true };
        }
        if (!config.privateKeyPath?.trim()) {
          return { success: false, error: 'A key file is required (or enable "Resident key on device")' };
        }
        const exists = await fs
          .stat(config.privateKeyPath)
          .then((s) => s.isFile())
          .catch(() => false);
        if (!exists) {
          return { success: false, error: `Key file not found: ${config.privateKeyPath}` };
        }
        return { success: true };
      }

      try {
        const port = config.port ?? 22;
        const provider = new SFTPStorageProvider(
          {
            id: `test-${crypto.randomUUID()}`,
            name: 'Test SSH',
            host: config.host,
            port,
            username: config.username,
            authType: config.authType,
            password: config.password,
            privateKeyPath: config.privateKeyPath,
            passphrase: config.passphrase,
            agentPath: config.agentPath,
            agentIdentityFiles: config.agentIdentityFiles,
            pkcs11LibPath: config.pkcs11LibPath,
            proxy: config.proxy,
          },
          undefined,
          createHostVerifier({
            host: config.host,
            port,
            onUnknownOrChanged: (info) => bridge.promptHostKeyTrust(info),
          })
        );
        await provider.ensureConnected();
        await provider.disconnect?.();
        return { success: true };
      } catch (err: any) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }
  );

  bridge.registerHandler(
    IPC_CHANNELS.CONNECTION_TEST_S3,
    async (_event, config: S3Config): Promise<{ success: boolean; error?: string }> => {
      if (!config || !config.region?.trim()) {
        return { success: false, error: 'Region is required' };
      }
      if (config.authMode === 'sso') {
        if (!config.sso?.startUrl?.trim() || !config.sso?.accountId?.trim() || !config.sso?.roleName?.trim()) {
          return { success: false, error: 'Start URL, Account, and Role are required for AWS SSO' };
        }
      } else if (!config.accessKeyId?.trim() || !config.secretAccessKey?.trim()) {
        return { success: false, error: 'Access Key ID and Secret Access Key are required' };
      }
      try {
        const provider = new S3StorageProvider({
          ...config,
          id: `test-${crypto.randomUUID()}`,
          name: 'Test S3',
        });
        await provider.client.send(new ListBucketsCommand({}));
        return { success: true };
      } catch (err: any) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }
  );
}
