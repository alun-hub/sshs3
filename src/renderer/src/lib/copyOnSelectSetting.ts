/**
 * The "copy on select" setting, for components that act on it from a document-level event rather than while
 * rendering (the Markdown preview copies on mouseup). App publishes it whenever the settings change, so the value
 * is live and no component has to ask the main process for it each time it is mounted.
 */
let enabled = false;

export function setCopyOnSelectEnabled(value: boolean): void {
  enabled = value;
}

export function isCopyOnSelectEnabled(): boolean {
  return enabled;
}
