import { IPC_CHANNELS } from '../../shared/types/ipc';
import type { AwsSsmTools } from '../../shared/types/ssm';
import { detectAwsSsmTools } from '../aws/AwsSsmToolchain';
import type { IpcBridge } from '../IpcBridge';

/** The part of IpcBridge this handler group may use. */
export type AwsSsmHost = Pick<IpcBridge, 'registerHandler'>;

export function registerAwsSsmHandlers(bridge: AwsSsmHost): void {
  // No arguments and no secrets cross this channel; the result is tool paths and versions only.
  bridge.registerHandler(IPC_CHANNELS.AWS_SSM_CHECK_TOOLS, async (): Promise<AwsSsmTools> => detectAwsSsmTools());
}
