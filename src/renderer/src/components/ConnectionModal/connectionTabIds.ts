import type { Tab } from './types';

// The DOM ids that tie the protocol tabs of the Connection Manager to the panel they control. One place, so the tab
// row and the panel cannot drift apart. `prefix` is unique per open dialog (React's `useId`).

/** Id of the tab for `tab`; the panel names it with `aria-labelledby`. */
export const protocolTabId = (prefix: string, tab: Tab): string => `${prefix}-tab-${tab}`;

/** Id of the panel the tabs control (`aria-controls`). */
export const protocolPanelId = (prefix: string): string => `${prefix}-panel`;
