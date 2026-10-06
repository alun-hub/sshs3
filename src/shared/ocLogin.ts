import type { K8sLoginOptions } from './types/kubernetes';

/**
 * Parses an `oc login` command pasted from the OpenShift Web Console or shell.
 * Extracts token, server URL, insecure-skip-tls-verify flag, namespace, and username.
 */
export function parseOcLoginCommand(cmd: string): Partial<K8sLoginOptions> {
  const result: Partial<K8sLoginOptions> = {};
  if (!cmd || typeof cmd !== 'string') return result;

  const trimmed = cmd.trim();
  const cleaned = trimmed.replace(/^oc\s+login\s+/i, '').replace(/^kubectl\s+/i, '');

  const tokenMatch = cleaned.match(/(?:--token[=\s]+|-t\s+)["']?([^"'\s]+)["']?/i);
  if (tokenMatch) {
    result.token = tokenMatch[1];
  }

  const serverMatch = cleaned.match(/(?:--server[=\s]+)["']?([^"'\s]+)["']?/i);
  if (serverMatch) {
    result.server = serverMatch[1];
  } else {
    const urlMatch = cleaned.match(/(https?:\/\/[^\s"']+)/i);
    if (urlMatch) {
      result.server = urlMatch[1];
    }
  }

  if (/--insecure-skip-tls-verify(?:=(?:true|1))?(?:\s|$)/i.test(cleaned)) {
    result.insecureSkipTlsVerify = true;
  } else if (/--insecure-skip-tls-verify=(?:false|0)(?:\s|$)/i.test(cleaned)) {
    result.insecureSkipTlsVerify = false;
  }

  const nsMatch = cleaned.match(/(?:--namespace[=\s]+|-n\s+)["']?([^"'\s]+)["']?/i);
  if (nsMatch) {
    result.namespace = nsMatch[1];
  }

  const uMatch = cleaned.match(/(?:--username[=\s]+|-u\s+)["']?([^"'\s]+)["']?/i);
  if (uMatch) {
    result.username = uMatch[1];
  }

  return result;
}
