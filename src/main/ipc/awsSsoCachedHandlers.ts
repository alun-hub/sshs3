import { globalAwsNetwork } from '../aws/awsNetworkSettings';
import { IPC_CHANNELS } from '../../shared/types/ipc';
import { isValidRegion, isValidStartUrl, normalizeStartUrl } from '../../shared/ssm';
import type { AwsSsoAccount, AwsSsoAccountRole, AwsSsoNetworkOptions } from '../../shared/types/aws';
import type { AwsSsoCachedRequest, AwsSsoStatusInfo } from '../../shared/types/awsScan';
import { assertAwsAllowed } from './ssmPreflight';
import type { IpcBridge } from '../IpcBridge';

/** The part of IpcBridge this handler group may use. */
export type AwsSsoCachedHost = Pick<IpcBridge, 'awsSsoAuthService' | 'policy' | 'registerHandler'> & Partial<Pick<IpcBridge, 'profileStore'>>;

const checkPolicy = (bridge: AwsSsoCachedHost): void => assertAwsAllowed(bridge.policy.policy);

function checkRequest(req: unknown, needsAccount: boolean): AwsSsoCachedRequest {
  const r = req as AwsSsoCachedRequest | undefined;
  // Validated like any IPC argument; the start URL only selects which token file the main process reads.
  if (!r || !isValidStartUrl(r.startUrl) || !isValidRegion(r.region)) throw new Error('Invalid AWS SSO request');
  if (needsAccount && !(typeof r.accountId === 'string' && /^\d{12}$/.test(r.accountId))) throw new Error('Invalid AWS account id');
  return r;
}

/** Network for a listing: a saved S3 profile's own proxy/CA when its id is given, otherwise the AWS settings. */
async function networkFor(bridge: AwsSsoCachedHost, r: AwsSsoCachedRequest): Promise<AwsSsoNetworkOptions | undefined> {
  if (typeof r.s3ProfileId !== 'string' || !bridge.profileStore) return globalAwsNetwork();
  const saved = (await bridge.profileStore.getProfiles()).s3?.find((p) => p.id === r.s3ProfileId);
  // Only a profile signed in to this very start URL may route its token, and it can never relax TLS verification
  // beyond what the AWS settings allow.
  if (!saved?.sso?.startUrl || normalizeStartUrl(saved.sso.startUrl) !== r.startUrl || (saved.sso.region ?? r.region) !== r.region) return globalAwsNetwork();
  if (!saved.proxy && !saved.customCaPath && saved.rejectUnauthorized === undefined) return globalAwsNetwork();
  const global = globalAwsNetwork();
  return {
    customCaPath: saved.customCaPath,
    rejectUnauthorized: saved.rejectUnauthorized === false ? global?.rejectUnauthorized : saved.rejectUnauthorized,
    proxy: saved.proxy,
  };
}

/**
 * Sign-in state and account/role listing for a start URL, using the token cache in the main process.
 * SECURITY: the access token never crosses IPC; results are status, expiry and the lists AWS returned. The renderer
 * cannot choose where the token is sent: proxy and CA come only from the AWS settings (`globalAwsNetwork`) or from a
 * saved S3 profile the main process looks up by id, never from values in the request, so a compromised renderer cannot point the token at a host of its own or switch off TLS verification.
 */
export function registerAwsSsoCachedHandlers(bridge: AwsSsoCachedHost): void {
  bridge.registerHandler(IPC_CHANNELS.AWS_SSO_STATUS, async (_event, startUrl: string): Promise<AwsSsoStatusInfo> => {
    if (!isValidStartUrl(startUrl)) throw new Error('Invalid AWS SSO start URL');
    return await bridge.awsSsoAuthService.getTokenInfo(startUrl);
  });

  bridge.registerHandler(
    IPC_CHANNELS.AWS_SSO_LIST_ACCOUNTS_CACHED,
    async (_event, req: AwsSsoCachedRequest): Promise<AwsSsoAccount[]> => {
      checkPolicy(bridge);
      const r = checkRequest(req, false);
      return await bridge.awsSsoAuthService.listAccountsCached(r.startUrl, r.region, await networkFor(bridge, r));
    }
  );

  bridge.registerHandler(
    IPC_CHANNELS.AWS_SSO_LIST_ROLES_CACHED,
    async (_event, req: AwsSsoCachedRequest): Promise<AwsSsoAccountRole[]> => {
      checkPolicy(bridge);
      const r = checkRequest(req, true);
      return await bridge.awsSsoAuthService.listAccountRolesCached(
        r.startUrl,
        r.region,
        r.accountId!,
        await networkFor(bridge, r)
      );
    }
  );
}
