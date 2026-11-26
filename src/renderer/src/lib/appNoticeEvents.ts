export const APP_NOTICE_EVENT = 'sshs3:app-notice';

/**
 * Shows a message in the app-wide notice, which stays visible whichever tab is active. A terminal's own notice is
 * only seen while that terminal is on screen, which it is not once something opens a new tab or another program.
 */
export function showAppNotice(message: string): void {
  window.dispatchEvent(new CustomEvent<string>(APP_NOTICE_EVENT, { detail: message }));
}
