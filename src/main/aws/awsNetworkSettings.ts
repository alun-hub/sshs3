import { awsNetworkToOptions } from '../../shared/awsSignIns';
import type { AwsNetworkSettings, AwsSsoNetworkOptions } from '../../shared/types/aws';

let current: AwsNetworkSettings | undefined;

/**
 * The proxy / CA from the AWS page of the settings. Loaded at startup and updated on every settings save, so callers
 * (sign-in, listing, scanning, and the environment of the `aws` CLI) read it synchronously.
 */
export function setAwsNetworkSettings(net: AwsNetworkSettings | undefined): void {
  current = net;
}

export function getAwsNetworkSettings(): AwsNetworkSettings | undefined {
  return current;
}

/**
 * Network options for AWS calls that did not bring their own (S3 profiles carry a per-profile proxy/CA and pass
 * it explicitly; everything else uses the AWS settings).
 */
export function globalAwsNetwork(): AwsSsoNetworkOptions {
  return awsNetworkToOptions(current);
}
