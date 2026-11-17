import { IPC_CHANNELS } from '../../shared/types/ipc';
import type { AwsSsmTools } from '../../shared/types/ssm';
import { detectAwsSsmTools } from '../aws/AwsSsmToolchain';
import { isFeatureAllowed } from '../policy/policyApply';
import { setSsmAllowed } from '../ssh/ssmProxy';
import type { IpcBridge } from '../IpcBridge';

/** The part of IpcBridge this handler group may use. */
export type AwsSsmHost = Pick<IpcBridge, 'policy' | 'registerHandler'>;

export function registerAwsSsmHandlers(bridge: AwsSsmHost): void {
  // The machine policy only changes with an app restart, so it is applied once, before any connection.
  setSsmAllowed(isFeatureAllowed(bridge.policy.policy, 'awsSsm'));
  // No arguments and no secrets cross this channel; the result is tool paths and versions only.
  bridge.registerHandler(IPC_CHANNELS.AWS_SSM_CHECK_TOOLS, async (): Promise<AwsSsmTools> => detectAwsSsmTools());
}
