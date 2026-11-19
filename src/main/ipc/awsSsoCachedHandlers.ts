import { globalAwsNetwork } from '../aws/awsNetworkSettings';
import { IPC_CHANNELS } from '../../shared/types/ipc';
import { isValidRegion, isValidStartUrl } from '../../shared/ssm';
import type { AwsSsoAccount, AwsSsoAccountRole } from '../../shared/types/aws';
import type { AwsSsoCachedRequest, AwsSsoStatusInfo } from '../../shared/types/awsScan';
import { isFeatureAllowed } from '../policy/policyApply';
import type { IpcBridge } from '../IpcBridge';

/** The part of IpcBridge this handler group may use. */
export type AwsSsoCachedHost = Pick<IpcBridge, 'awsSsoAuthService' | 'policy' | 'registerHandler'>;

function checkPolicy(bridge: AwsSsoCachedHost): void {
  if (!isFeatureAllowed(bridge.policy.policy, 'awsSsm')) throw new Error('AWS features are disabled by your administrator');
}

function checkRequest(req: unknown, needsAccount: boolean): AwsSsoCachedRequest {
  const r = req as AwsSsoCachedRequest | undefined;
  // Validated like any IPC argument; the start URL only selects which token file the main process reads.
  if (!r || !isValidStartUrl(r.startUrl) || !isValidRegion(r.region)) throw new Error('Invalid AWS SSO request');
  if (needsAccount && !(typeof r.accountId === 'string' && /^\d{12}$/.test(r.accountId))) throw new Error('Invalid AWS account id');
  return r;
}

/**
 * Sign-in state and account/role listing for a start URL, using the token cache in the main process.
 * SECURITY: the access token never crosses IPC; results are status, expiry and the lists AWS returned. The renderer
 * cannot choose where the token is sent: proxy and CA come only from the AWS settings (`globalAwsNetwork`), never from
 * the request, so a compromised renderer cannot point the token at a host of its own or switch off TLS verification.
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
      return await bridge.awsSsoAuthService.listAccountsCached(r.startUrl, r.region, globalAwsNetwork());
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
        globalAwsNetwork()
      );
    }
  );
}
