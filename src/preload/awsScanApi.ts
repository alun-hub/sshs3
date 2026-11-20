import { ipcRenderer } from 'electron';
import { AWS_SCAN_CHANNELS, type AwsScanElectronApi } from '../shared/types/awsScanIpc';
import type { AwsScanProgressEvent } from '../shared/types/awsScan';

/** Renderer side of the AWS scan/profile/cached-sign-in channels (spread into the preload API). */
export const awsScanApi: AwsScanElectronApi = {
  awsSsmScan: (request) => ipcRenderer.invoke(AWS_SCAN_CHANNELS.AWS_SSM_SCAN, request),
  awsSsmScanCancel: (scanId) => ipcRenderer.invoke(AWS_SCAN_CHANNELS.AWS_SSM_SCAN_CANCEL, scanId),
  onAwsSsmScanProgress: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, event: AwsScanProgressEvent) => callback(event);
    ipcRenderer.on(AWS_SCAN_CHANNELS.AWS_SSM_SCAN_PROGRESS, listener);
    return () => {
      ipcRenderer.removeListener(AWS_SCAN_CHANNELS.AWS_SSM_SCAN_PROGRESS, listener);
    };
  },
  awsSsmListProfiles: () => ipcRenderer.invoke(AWS_SCAN_CHANNELS.AWS_SSM_LIST_PROFILES),
  awsSsmProfileStatus: (name) => ipcRenderer.invoke(AWS_SCAN_CHANNELS.AWS_SSM_PROFILE_STATUS, name),
  awsSsmProfileLogin: (name) => ipcRenderer.invoke(AWS_SCAN_CHANNELS.AWS_SSM_PROFILE_LOGIN, name),
  awsSsoStatus: (startUrl) => ipcRenderer.invoke(AWS_SCAN_CHANNELS.AWS_SSO_STATUS, startUrl),
  awsSsoListAccountsCached: (request) => ipcRenderer.invoke(AWS_SCAN_CHANNELS.AWS_SSO_LIST_ACCOUNTS_CACHED, request),
  awsSsoListRolesCached: (request) => ipcRenderer.invoke(AWS_SCAN_CHANNELS.AWS_SSO_LIST_ROLES_CACHED, request),
};
