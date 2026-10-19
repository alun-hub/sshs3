/**
 * The printable text in a chunk of terminal input: escape sequences (cursor keys, the markers a bracketed
 * paste is wrapped in) and other control characters are dropped. Used to keep track of what was typed on
 * the current line.
 */
export function printableInput(data: string): string {
  return (
    data
      // eslint-disable-next-line no-control-regex
      .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]|\x1bO[@-~]/g, '')
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x1f\x7f-\x9f]/g, '')
  );
}
