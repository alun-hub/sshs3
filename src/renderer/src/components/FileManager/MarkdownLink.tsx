import React, { type ReactNode } from 'react';
import { externalLinkTarget } from '../../lib/markdownLinks';

/**
 * A link of the markdown preview. The window blocks navigation, so a plain `<a href>` does nothing;
 * a web link is opened in the system browser instead. Every other kind (relative, `#anchor`, `mailto:`
 * and so on) is shown as ordinary text rather than as a link that looks clickable and is not.
 * The title shows where a link really goes, since the text of a link can say anything.
 */
export const MarkdownLink: React.FC<{ href?: string; children?: ReactNode }> = ({ href, children }) => {
  const target = externalLinkTarget(href);
  if (!target) {
    return <span title={href || undefined}>{children}</span>;
  }
  return (
    <a
      href={target}
      title={target}
      rel="noreferrer noopener"
      onClick={(event) => {
        event.preventDefault();
        void window.multissh?.openExternal(target);
      }}
    >
      {children}
    </a>
  );
};
