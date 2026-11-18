import { IPC_CHANNELS } from '../../shared/types/ipc';
import { isValidRegion, isValidSsoConfig } from '../../shared/ssm';
import type { AwsSsmTools, SsmDiscoveryRequest, SsmDiscoveryResult } from '../../shared/types/ssm';
import { detectAwsSsmTools } from '../aws/AwsSsmToolchain';
import { discoverInstances } from '../aws/AwsSsmDiscoveryService';
import { isFeatureAllowed } from '../policy/policyApply';
import { setSsmAllowed } from '../ssh/ssmProxy';
import { assertSsmSignedIn } from './ssmPreflight';
import { registerAwsScanHandlers } from './awsScanHandlers';
import { registerAwsSsoCachedHandlers } from './awsSsoCachedHandlers';
import type { IpcBridge } from '../IpcBridge';

/** The part of IpcBridge this handler group may use. */
export type AwsSsmHost = Pick<IpcBridge, 'awsSsoAuthService' | 'policy' | 'registerHandler' | 'sendToSender'>;

export function registerAwsSsmHandlers(bridge: AwsSsmHost): void {
  // The machine policy only changes with an app restart, so it is applied once, before any connection.
  setSsmAllowed(isFeatureAllowed(bridge.policy.policy, 'awsSsm'));
  registerAwsScanHandlers(bridge);
  registerAwsSsoCachedHandlers(bridge);

  // No arguments and no secrets cross this channel; the result is tool paths and versions only.
  bridge.registerHandler(IPC_CHANNELS.AWS_SSM_CHECK_TOOLS, async (): Promise<AwsSsmTools> => detectAwsSsmTools());

  bridge.registerHandler(
    IPC_CHANNELS.AWS_SSM_DISCOVER_INSTANCES,
    async (_event, request: SsmDiscoveryRequest): Promise<SsmDiscoveryResult> => {
      // Arguments are validated here: the renderer is not trusted to send well-formed values.
      if (!request || !isValidSsoConfig(request.sso) || !isValidRegion(request.region)) {
        throw new Error('Invalid AWS discovery request');
      }
      await assertSsmSignedIn(bridge.awsSsoAuthService, { enabled: true, sso: request.sso }, bridge.policy.policy);
      return await discoverInstances({ sso: request.sso, region: request.region });
    }
  );
}
