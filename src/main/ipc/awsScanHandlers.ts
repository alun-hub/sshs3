import { globalAwsNetwork } from '../aws/awsNetworkSettings';
import { execFile } from 'node:child_process';
import { IPC_CHANNELS } from '../../shared/types/ipc';
import { isValidScanId, normalizeScanRequest, validateScanRequest } from '../../shared/awsScan';
import { isValidAwsProfile } from '../../shared/ssm';
import { AWS_SSO_EXPIRED_PREFIX } from '../../shared/types/aws';
import type {
  AwsCliProfile,
  AwsProfileLoginResult,
  AwsProfileStatus,
  AwsScanIpcRequest,
  AwsScanProgressEvent,
  AwsScanResult,
} from '../../shared/types/awsScan';
import { buildCredentialProvider } from '../aws/awsCredentials';
import { listAwsCliProfiles } from '../aws/awsProfiles';
import { scanInstances } from '../aws/awsScanService';
import { locateTools } from '../aws/AwsSsmToolchain';
import { getAwsNetworkSettings } from '../aws/awsNetworkSettings';
import { networkEnvFor } from '../ssh/ssmProxy';
import { assertAwsAllowed } from './ssmPreflight';
import type { IpcBridge } from '../IpcBridge';

/** The part of IpcBridge this handler group may use. */
export type AwsScanHost = Pick<IpcBridge, 'awsSsoAuthService' | 'policy' | 'registerHandler' | 'sendToSender'>;

const PROFILE_STATUS_TIMEOUT_MS = 20_000;
const PROFILE_LOGIN_TIMEOUT_MS = 5 * 60_000;

// Scans in flight, so a cancel can reach them. Module-private on purpose (see tests/main/ipcHostAccess.test.ts).
const pendingScans = new Map<string, AbortController>();

/** A profile that needs input cannot be answered from a GUI; say what to do instead of showing the raw SDK text. */
export function describeProfileError(err: unknown, name: string): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/mfa|token code/i.test(message)) {
    return `This profile needs an MFA code. Run "aws sts get-caller-identity --profile ${name}" once in a terminal, then try again.`;
  }
  // Only a lapsed session says "expired": other token errors (invalid or rejected credentials) keep their own message.
  if (/sso session|session .*expired|token (has )?expired|expired token|refresh token|sso token/i.test(message)) return `The sign-in for this profile has expired. Sign in again.`;
  return message.replace(/^Error:\s*/, '') || 'Could not get credentials for this profile';
}

async function requireProfile(name: unknown, kind?: AwsCliProfile['kind']): Promise<string> {
  if (!isValidAwsProfile(name)) throw new Error('Invalid AWS CLI profile name');
  const known = (await listAwsCliProfiles()).find((p) => p.name === name);
  if (!known) throw new Error('That profile is not in your AWS CLI configuration');
  if (kind && known.kind !== kind) throw new Error('That profile does not use AWS SSO');
  return name;
}

export function registerAwsScanHandlers(bridge: AwsScanHost): void {
  const checkPolicy = (): void => assertAwsAllowed(bridge.policy.policy);

  bridge.registerHandler(
    IPC_CHANNELS.AWS_SSM_SCAN,
    async (event, req: AwsScanIpcRequest): Promise<AwsScanResult> => {
      checkPolicy();
      if (!req || !isValidScanId(req.scanId)) throw new Error('Invalid scan request');
      const problem = validateScanRequest(req.request);
      if (problem) throw new Error(problem);
      if (pendingScans.has(req.scanId)) throw new Error('This scan is already running');
      const request = normalizeScanRequest(req.request);

      // Registered before any await so a cancel or a duplicate id cannot slip into the token checks below.
      const controller = new AbortController();
      pendingScans.set(req.scanId, controller);
      const sender = (event as { sender?: unknown } | undefined)?.sender as Parameters<AwsScanHost['sendToSender']>[0];
      try {
        // Sign-ins that are gone fail fast with the "session expired" prefix the UI offers a sign-in for.
        for (const url of new Set(request.targets.flatMap((t) => (t.source.kind === 'sso' ? [t.source.sso.startUrl] : [])))) {
          if ((await bridge.awsSsoAuthService.getTokenStatus(url)) !== 'valid') throw new Error(`${AWS_SSO_EXPIRED_PREFIX}: sign in again to continue.`);
        }
        if (controller.signal.aborted) return { searched: 0, skipped: [], instances: [], truncated: false };
        return await scanInstances(request, {
          network: globalAwsNetwork(),
          signal: controller.signal,
          onProgress: (p) => {
            const progress: AwsScanProgressEvent = { scanId: req.scanId, ...p };
            bridge.sendToSender(sender, IPC_CHANNELS.AWS_SSM_SCAN_PROGRESS, progress);
          },
        });
      } finally {
        pendingScans.delete(req.scanId);
      }
    }
  );

  bridge.registerHandler(IPC_CHANNELS.AWS_SSM_SCAN_CANCEL, async (_event, scanId: string): Promise<void> => {
    if (isValidScanId(scanId)) pendingScans.get(scanId)?.abort();
  });

  bridge.registerHandler(IPC_CHANNELS.AWS_SSM_LIST_PROFILES, async (): Promise<AwsCliProfile[]> => {
    checkPolicy();
    return await listAwsCliProfiles();
  });

  bridge.registerHandler(IPC_CHANNELS.AWS_SSM_PROFILE_STATUS, async (_event, name: string): Promise<AwsProfileStatus> => {
    checkPolicy();
    const profile = await requireProfile(name);
    try {
      const provider = buildCredentialProvider({ kind: 'profile', name: profile }, globalAwsNetwork()) as () => Promise<{ expiration?: Date }>;
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Timed out waiting for credentials')), PROFILE_STATUS_TIMEOUT_MS);
      });
      try {
        const creds = await Promise.race([provider(), timeout]);
        return { ok: true, expiresAt: creds.expiration?.toISOString() };
      } finally {
        if (timer) clearTimeout(timer);
      }
    } catch (err) {
      return { ok: false, message: describeProfileError(err, profile) };
    }
  });

  bridge.registerHandler(IPC_CHANNELS.AWS_SSM_PROFILE_LOGIN, async (_event, name: string): Promise<AwsProfileLoginResult> => {
    checkPolicy();
    const profile = await requireProfile(name, 'sso');
    const aws = locateTools().aws ?? 'aws';
    return await new Promise<AwsProfileLoginResult>((resolve) => {
      // Fixed arguments plus a profile name validated above and found in the user's own configuration; no shell.
      // nosemgrep: javascript.lang.security.detect-child-process -- see above
      execFile(aws, ['sso', 'login', '--profile', profile], { timeout: PROFILE_LOGIN_TIMEOUT_MS, windowsHide: true, maxBuffer: 64 * 1024, env: { ...process.env, ...networkEnvFor(getAwsNetworkSettings(), process.env, process.platform) } }, (err) => {
        resolve(err ? { ok: false, message: 'The AWS CLI sign-in did not complete. Try again, or run "aws sso login" in a terminal.' } : { ok: true });
      });
    });
  });
}
