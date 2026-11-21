import { networkForSavedS3Profile } from '../aws/ssoNetwork';
import { IPC_CHANNELS } from '../../shared/types/ipc';
import { isValidRegion, isValidStartUrl } from '../../shared/ssm';
import type { AwsSsoAccount, AwsSsoAccountRole } from '../../shared/types/aws';
import type { AwsSsoCachedRequest, AwsSsoStatusInfo } from '../../shared/types/awsScan';
import type { IpcBridge } from '../IpcBridge';

/** The part of IpcBridge this handler group may use. */
export type AwsSsoCachedHost = Pick<IpcBridge, 'awsSsoAuthService' | 'registerHandler'> & Partial<Pick<IpcBridge, 'profileStore'>>;

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
 * cannot choose where the token is sent: proxy and CA come only from the AWS settings (`globalAwsNetwork`) or from a
 * saved S3 profile the main process looks up by id, never from values in the request, so a compromised renderer cannot point the token at a host of its own or switch off TLS verification.
 *
 * No `awsSsm` policy check here, on purpose: these calls only read the state and the account/role lists of a sign-in the user
 * already holds, and the S3 profile form and the sync target form use them for IAM Identity Center sign-ins that have nothing
 * to do with Systems Manager. The policy blocks what SSM does: the instance search (`awsScanHandlers`) and the connection
 * (`assertSsmSignedIn`).
 */
export function registerAwsSsoCachedHandlers(bridge: AwsSsoCachedHost): void {
  bridge.registerHandler(IPC_CHANNELS.AWS_SSO_STATUS, async (_event, startUrl: string): Promise<AwsSsoStatusInfo> => {
    if (!isValidStartUrl(startUrl)) throw new Error('Invalid AWS SSO start URL');
    return await bridge.awsSsoAuthService.getTokenInfo(startUrl);
  });

  bridge.registerHandler(
    IPC_CHANNELS.AWS_SSO_LIST_ACCOUNTS_CACHED,
    async (_event, req: AwsSsoCachedRequest): Promise<AwsSsoAccount[]> => {
      const r = checkRequest(req, false);
      return await bridge.awsSsoAuthService.listAccountsCached(r.startUrl, r.region, await networkForSavedS3Profile(bridge.profileStore, r.s3ProfileId, r.startUrl, r.region));
    }
  );

  bridge.registerHandler(
    IPC_CHANNELS.AWS_SSO_LIST_ROLES_CACHED,
    async (_event, req: AwsSsoCachedRequest): Promise<AwsSsoAccountRole[]> => {
      const r = checkRequest(req, true);
      return await bridge.awsSsoAuthService.listAccountRolesCached(
        r.startUrl,
        r.region,
        r.accountId!,
        await networkForSavedS3Profile(bridge.profileStore, r.s3ProfileId, r.startUrl, r.region)
      );
    }
  );
}
