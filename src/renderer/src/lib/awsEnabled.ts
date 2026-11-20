import { createContext, useContext } from 'react';

/**
 * Whether AWS features are switched on (Settings → AWS, or locked by policy). Provided once by the app root so that
 * deep components (profile form, connection manager, top bar) need no prop drilling. Off by default.
 */
export const AwsEnabledContext = createContext<boolean>(false);

export function useAwsEnabled(): boolean {
  return useContext(AwsEnabledContext);
}
