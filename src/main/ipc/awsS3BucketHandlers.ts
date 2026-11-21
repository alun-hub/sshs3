import { describeS3Error } from '../aws/awsErrors';
import { listS3Buckets, s3BucketRegion } from '../aws/awsS3Buckets';
import { networkForSavedS3Profile } from '../aws/ssoNetwork';
import { IPC_CHANNELS } from '../../shared/types/ipc';
import { isValidSsoConfig } from '../../shared/ssm';
import type { AwsSsoConfig } from '../../shared/types/aws';
import type { AwsS3Bucket, AwsS3BucketsRequest } from '../../shared/types/awsScan';
import type { IpcBridge } from '../IpcBridge';

/** The part of IpcBridge this handler group may use. */
export type AwsS3BucketHost = Pick<IpcBridge, 'registerHandler'> & Partial<Pick<IpcBridge, 'profileStore'>>;

function checkRequest(req: unknown): { sso: AwsSsoConfig; request: AwsS3BucketsRequest } {
  const r = req as AwsS3BucketsRequest | undefined;
  const sso = { startUrl: r?.startUrl, region: r?.region, accountId: r?.accountId, roleName: r?.roleName };
  // Validated like any IPC argument: the account and role are required, the start URL only selects which token file is read.
  if (!r || !isValidSsoConfig(sso) || !sso.accountId || !sso.roleName) throw new Error('Invalid AWS S3 request');
  return { sso, request: r };
}

/**
 * The S3 buckets of an IAM Identity Center account/role, for the "Pick bucket" button of the S3 profile form.
 * SECURITY: the access token never crosses IPC and is used only inside the AWS SDK of the main process. As for the account and
 * role lists, the renderer supplies at most the id of a SAVED S3 profile; proxy and CA come from the AWS settings or from that
 * profile as the main process finds it, never from the request, so a compromised renderer cannot send the credentials to a host
 * of its own or turn TLS verification off. No `awsSsm` policy check: this is S3, not Systems Manager.
 */
export function registerAwsS3BucketHandlers(bridge: AwsS3BucketHost): void {
  bridge.registerHandler(IPC_CHANNELS.AWS_S3_LIST_BUCKETS, async (_event, req: AwsS3BucketsRequest): Promise<AwsS3Bucket[]> => {
    const { sso, request } = checkRequest(req);
    try {
      return await listS3Buckets(sso, await networkForSavedS3Profile(bridge.profileStore, request.s3ProfileId, sso.startUrl, sso.region));
    } catch (err) {
      throw new Error(describeS3Error(err, true), { cause: err });
    }
  });

  bridge.registerHandler(
    IPC_CHANNELS.AWS_S3_BUCKET_REGION,
    async (_event, req: AwsS3BucketsRequest & { bucket: string }): Promise<string | undefined> => {
      const { sso, request } = checkRequest(req);
      if (typeof req.bucket !== 'string') throw new Error('Invalid bucket name');
      try {
        return await s3BucketRegion(sso, req.bucket, await networkForSavedS3Profile(bridge.profileStore, request.s3ProfileId, sso.startUrl, sso.region));
      } catch (err) {
        throw new Error(describeS3Error(err, true), { cause: err });
      }
    }
  );
}
