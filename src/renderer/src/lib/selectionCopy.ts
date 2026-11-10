/** True if both ranges cover exactly the same span of the document. */
export function sameRange(a: Range, b: Range): boolean {
  return a.compareBoundaryPoints(Range.START_TO_START, b) === 0 && a.compareBoundaryPoints(Range.END_TO_END, b) === 0;
}

/** True for Ctrl+Shift+C (Cmd+Shift+C on macOS): the terminal-style "copy selection" shortcut. */
export function isCopyShortcut(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>): boolean {
  return (e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'c';
}

const BLOCK_TAGS = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DD', 'DIV', 'DL', 'DT', 'FIGURE', 'FOOTER', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION', 'TABLE', 'TR', 'UL',
]);

/** The text of a cloned range: its text nodes in order, with a line break after each block and for <br>. */
function textOf(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
  if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return '';
  if ((node as Element).tagName === 'BR') return '\n';
  let text = Array.from(node.childNodes, textOf).join('');
  if (BLOCK_TAGS.has((node as Element).tagName) && text && !text.endsWith('\n')) text += '\n';
  return text;
}

/**
 * The selected text that lies inside `container`, else ''. A selection wholly inside is the browser's own text. One
 * that reaches outside (a drag that starts or ends over another pane, or below the text) is clipped to the container,
 * so the part inside is still copied.
 */
export function selectedTextWithin(container: Node | null, selection: Selection | null): string {
  if (!container || !selection || selection.isCollapsed || selection.rangeCount === 0) return '';
  const range = selection.getRangeAt(0);
  if (container.contains(range.commonAncestorContainer)) return selection.toString();
  const inside = document.createRange();
  inside.selectNodeContents(container);
  const clipped = range.cloneRange();
  if (clipped.compareBoundaryPoints(Range.START_TO_START, inside) < 0) clipped.setStart(inside.startContainer, inside.startOffset);
  if (clipped.compareBoundaryPoints(Range.END_TO_END, inside) > 0) clipped.setEnd(inside.endContainer, inside.endOffset);
  return textOf(clipped.cloneContents()).replace(/\n+$/, '');
}
