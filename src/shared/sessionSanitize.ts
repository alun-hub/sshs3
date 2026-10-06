import type { PaneNode } from './types/session';

/**
 * Strips every credential from a pane tree before it is persisted as the saved
 * session (password, key passphrase, smartcard/FIDO2 PIN, proxy password), so the
 * session file never contains secrets. Shared by the main process (SessionStore)
 * and the renderer.
 */
export function sanitizePaneNode(node: PaneNode): PaneNode {
  if (node.type === 'leaf') {
    if (!node.config) return node;
    const { password: _password, passphrase: _passphrase, pin: _pin, ...restConfig } = node.config;
    if (restConfig.proxy) {
      const { password: _proxyPassword, ...restProxy } = restConfig.proxy;
      restConfig.proxy = restProxy;
    }
    return {
      ...node,
      config: restConfig,
    };
  }
  if (node.type === 'split' && Array.isArray(node.children)) {
    return {
      ...node,
      children: node.children.map(sanitizePaneNode),
    };
  }
  return node;
}
