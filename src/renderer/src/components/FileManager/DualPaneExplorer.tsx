import React, { useCallback, useEffect, useState } from 'react';
import type { SSHConnectionConfig } from '@shared/types/ssh';
import type { S3Config, SFTPConfig } from '@shared/types/storage';
import type { SavedPaneState } from '@shared/types/session';
import { ConnectionManagerModal } from '../ConnectionModal/ConnectionManagerModal';
import { DragDropProvider } from './DragDropLayer';
import { FilePane } from './FilePane';
import { TransferQueueDrawer } from './TransferQueueDrawer';
import type { PaneSide, PaneSource, SourceType } from './types';
import type { TransferConflictResolution } from '@shared/types/ipc';

const DEFAULT_SOURCE: Record<PaneSide, PaneSource> = {
  left: { providerId: 'local', sourceType: 'local', label: 'Lokal disk' },
  right: { providerId: 'local', sourceType: 'local', label: 'Lokal disk' },
};

interface PaneState {
  source: PaneSource;
  path: string;
}

export const DualPaneExplorer: React.FC = () => {
  const [panes, setPanes] = useState<Record<PaneSide, PaneState>>({
    left: { source: DEFAULT_SOURCE.left, path: '/' },
    right: { source: DEFAULT_SOURCE.right, path: '/' },
  });
  const [refreshToken, setRefreshToken] = useState(0);
  const [ready, setReady] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [connectionRequest, setConnectionRequest] = useState<{ side: PaneSide; type: SourceType } | null>(null);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    let mounted = true;
    void window.multissh
      .connectStorage({ id: 'local', name: 'Lokal disk', type: 'local' })
      .then(async () => {
        if (!mounted) return;
        const [session, profiles] = await Promise.all([
          window.multissh.sessionGet?.(),
          window.multissh.profilesGet?.(),
        ]);
        if (!mounted) return;

        const restoreSide = async (_side: PaneSide, savedPane?: SavedPaneState): Promise<PaneState> => {
          if (!savedPane || savedPane.sourceType === 'local') {
            const localPath = session?.lastPaths?.['local'] || savedPane?.path || '/';
            return {
              source: { providerId: 'local', sourceType: 'local', label: 'Lokal disk' },
              path: localPath,
            };
          }

          if (savedPane.sourceType === 's3' && profiles?.s3) {
            const s3Profile = profiles.s3.find((p) => `s3-${p.id}` === savedPane.providerId);
            if (s3Profile) {
              try {
                await window.multissh.connectStorage({
                  id: savedPane.providerId,
                  name: s3Profile.name,
                  type: 's3',
                  s3Config: s3Profile,
                });
                return {
                  source: { providerId: savedPane.providerId, sourceType: 's3', label: s3Profile.name },
                  path: savedPane.path || session?.lastPaths?.[savedPane.providerId] || '/',
                };
              } catch (err) {
                console.warn('Could not auto-reconnect S3 pane on startup:', err);
              }
            }
          }

          if (savedPane.sourceType === 'sftp' && profiles?.ssh) {
            const sshProfile = profiles.ssh.find((p) => `sftp-${p.id}` === savedPane.providerId);
            // Only auto-connect SFTP if non-interactive credentials exist (saved password, private key, or agent)
            if (
              sshProfile &&
              sshProfile.authType !== 'smartcard' &&
              (sshProfile.password || sshProfile.privateKeyPath || sshProfile.authType === 'agent')
            ) {
              try {
                const sftpConfig: SFTPConfig = {
                  id: sshProfile.id,
                  name: sshProfile.name,
                  host: sshProfile.host,
                  port: sshProfile.port ?? 22,
                  username: sshProfile.username,
                  authType: sshProfile.authType,
                  password: sshProfile.password,
                  privateKeyPath: sshProfile.privateKeyPath,
                  passphrase: sshProfile.passphrase,
                  agentPath: sshProfile.agentPath,
                  initialPath: sshProfile.initialPath,
                  proxy: sshProfile.proxy,
                };
                await window.multissh.connectStorage({
                  id: savedPane.providerId,
                  name: sshProfile.name,
                  type: 'sftp',
                  sftpConfig,
                });
                return {
                  source: { providerId: savedPane.providerId, sourceType: 'sftp', label: sshProfile.name },
                  path: savedPane.path || session?.lastPaths?.[savedPane.providerId] || '/',
                };
              } catch (err) {
                console.warn('Could not auto-reconnect SFTP pane on startup:', err);
              }
            }
          }

          // Fallback safely to local disk if remote provider cannot be auto-connected
          return {
            source: { providerId: 'local', sourceType: 'local', label: 'Lokal disk' },
            path: session?.lastPaths?.['local'] || '/',
          };
        };

        const left = await restoreSide('left', session?.panes?.left);
        const right = await restoreSide('right', session?.panes?.right);

        if (mounted) {
          setPanes({ left, right });
          setReady(true);
        }
      })
      .catch((err) => {
        if (mounted) {
          setInitError(err instanceof Error ? err.message : 'Kunde inte ansluta till lokal disk');
          setReady(true);
        }
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const unsub = window.multissh.onTransferProgress((progress) => {
      if (progress.status === 'completed') {
        setRefreshToken((t) => t + 1);
      }
    });
    return unsub;
  }, []);

  const persistPaneState = (updatedPanes: Record<PaneSide, PaneState>) => {
    void window.multissh.sessionGet?.().then((session) => {
      const lastPaths = {
        ...(session?.lastPaths || {}),
        [updatedPanes.left.source.providerId]: updatedPanes.left.path,
        [updatedPanes.right.source.providerId]: updatedPanes.right.path,
      };
      void window.multissh.sessionSave?.({
        tabs: session?.tabs || [],
        activeTabId: session?.activeTabId || '',
        lastPaths,
        panes: {
          left: {
            sourceType: updatedPanes.left.source.sourceType,
            providerId: updatedPanes.left.source.providerId,
            label: updatedPanes.left.source.label,
            path: updatedPanes.left.path,
          },
          right: {
            sourceType: updatedPanes.right.source.sourceType,
            providerId: updatedPanes.right.source.providerId,
            label: updatedPanes.right.source.label,
            path: updatedPanes.right.path,
          },
        },
      });
    });
  };

  const setPanePath = useCallback((side: PaneSide, path: string) => {
    setPanes((prev) => {
      const next = { ...prev, [side]: { ...prev[side], path } };
      persistPaneState(next);
      return next;
    });
  }, []);

  const setPaneSourceType = useCallback((side: PaneSide, type: SourceType) => {
    if (type === 'local') {
      setPanes((prev) => {
        const next = {
          ...prev,
          [side]: { source: { providerId: 'local', sourceType: 'local', label: 'Lokal disk' }, path: prev[side].path },
        };
        persistPaneState(next);
        return next;
      });
      return;
    }
    setConnectionRequest({ side, type });
  }, []);

  const connectPaneToSSH = useCallback(
    async (config: SSHConnectionConfig) => {
      if (!connectionRequest) return;
      const { side } = connectionRequest;
      let pin: string | undefined;
      if (config.authType === 'smartcard') {
        pin = window.prompt(`Ange PIN-kod för smartcard (${config.name}):`) ?? undefined;
        if (!pin) return;
      }
      setConnecting(true);
      try {
        const sftpConfig: SFTPConfig = {
          id: config.id,
          name: config.name,
          host: config.host,
          port: config.port ?? 22,
          username: config.username,
          authType: config.authType,
          password: config.password,
          privateKeyPath: config.privateKeyPath,
          passphrase: config.passphrase,
          agentPath: config.agentPath,
          pkcs11LibPath: config.pkcs11LibPath,
          pin,
          initialPath: config.initialPath,
          proxy: config.proxy,
        };
        const providerId = `sftp-${config.id}`;
        const session = await window.multissh.sessionGet?.();
        const initialPath = session?.lastPaths?.[providerId] || config.initialPath?.trim() || '/';
        await window.multissh.connectStorage({ id: providerId, name: config.name, type: 'sftp', sftpConfig });
        setPanes((prev) => {
          const next = {
            ...prev,
            [side]: { source: { providerId, sourceType: 'sftp' as const, label: config.name }, path: initialPath },
          };
          persistPaneState(next);
          return next;
        });
        setConnectionRequest(null);
      } catch (err) {
        window.alert(err instanceof Error ? err.message : 'Kunde inte ansluta till SFTP-servern');
      } finally {
        setConnecting(false);
      }
    },
    [connectionRequest]
  );

  const connectPaneToS3 = useCallback(
    async (config: S3Config) => {
      if (!connectionRequest) return;
      const { side } = connectionRequest;
      setConnecting(true);
      try {
        const providerId = `s3-${config.id}`;
        const session = await window.multissh.sessionGet?.();
        const initialPath = session?.lastPaths?.[providerId] || config.initialPath?.trim() || '/';
        await window.multissh.connectStorage({ id: providerId, name: config.name, type: 's3', s3Config: config });
        setPanes((prev) => {
          const next = {
            ...prev,
            [side]: { source: { providerId, sourceType: 's3' as const, label: config.name }, path: initialPath },
          };
          persistPaneState(next);
          return next;
        });
        setConnectionRequest(null);
      } catch (err) {
        window.alert(err instanceof Error ? err.message : 'Kunde inte ansluta till S3');
      } finally {
        setConnecting(false);
      }
    },
    [connectionRequest]
  );

  const handleTransferRequested = useCallback(
    (targetSide: PaneSide, params: { sourceProviderId: string; sourcePaths: string[]; targetPath: string }) => {
      const targetProviderId = panes[targetSide].source.providerId;
      void (async () => {
        // Sequential, not Promise.all: each conflicting file may show a
        // TOFU-style dialog, and "apply to all" needs to carry the user's
        // choice into the remaining items of this same drop/batch.
        let batchPolicy: TransferConflictResolution | undefined;
        for (const sourcePath of params.sourcePaths) {
          const result = await window.multissh.transferAdd({
            sourceProviderId: params.sourceProviderId,
            sourcePath,
            targetProviderId,
            targetPath: params.targetPath,
            conflictPolicy: batchPolicy,
          });
          if (result.appliedToAll && result.resolvedPolicy) {
            batchPolicy = result.resolvedPolicy;
          }
        }
        setRefreshToken((t) => t + 1);
      })();
    },
    [panes]
  );

  if (!ready) {
    return <div className="flex flex-1 items-center justify-center text-sm text-slate-400">Initierar filhanterare...</div>;
  }

  return (
    <DragDropProvider>
      <div className="flex min-h-0 flex-1 flex-col">
        {initError && (
          <div className="border-b border-red-900 bg-red-950/50 px-3 py-1 text-xs text-red-300">{initError}</div>
        )}
        <div className="flex min-h-0 flex-1 gap-1 bg-slate-950 p-1">
          <FilePane
            side="left"
            source={panes.left.source}
            currentPath={panes.left.path}
            onPathChange={(path) => setPanePath('left', path)}
            onSourceTypeRequest={(type) => setPaneSourceType('left', type)}
            onTransferRequested={(params) => handleTransferRequested('left', params)}
            refreshToken={refreshToken}
          />
          <FilePane
            side="right"
            source={panes.right.source}
            currentPath={panes.right.path}
            onPathChange={(path) => setPanePath('right', path)}
            onSourceTypeRequest={(type) => setPaneSourceType('right', type)}
            onTransferRequested={(params) => handleTransferRequested('right', params)}
            refreshToken={refreshToken}
          />
        </div>
        <TransferQueueDrawer />
      </div>
      <ConnectionManagerModal
        open={connectionRequest !== null}
        initialTab={connectionRequest?.type === 's3' ? 's3' : 'ssh'}
        onClose={() => {
          if (!connecting) setConnectionRequest(null);
        }}
        onConnectSSH={connecting ? undefined : (config) => void connectPaneToSSH(config)}
        onConnectS3={connecting ? undefined : (config) => void connectPaneToS3(config)}
      />
    </DragDropProvider>
  );
};

export default DualPaneExplorer;
