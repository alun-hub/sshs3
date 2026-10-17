import type { Extension } from '@codemirror/state';
import { StreamLanguage } from '@codemirror/language';
import { json } from '@codemirror/lang-json';
import { yaml } from '@codemirror/lang-yaml';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { markdown } from '@codemirror/lang-markdown';

// StreamLanguage legacy modes
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { dockerFile } from '@codemirror/legacy-modes/mode/dockerfile';
import { toml } from '@codemirror/legacy-modes/mode/toml';
import { nginx } from '@codemirror/legacy-modes/mode/nginx';
import { standardSQL } from '@codemirror/legacy-modes/mode/sql';

/**
 * Returns the appropriate CodeMirror 6 language extension for a given file name.
 */
export function getLanguageExtension(fileName: string): Extension | null {
  if (!fileName) return null;
  const lower = fileName.toLowerCase();
  const ext = lower.split('.').pop() || '';

  if (lower === 'dockerfile' || lower.endsWith('.dockerfile')) {
    return StreamLanguage.define(dockerFile);
  }
  if (lower.endsWith('nginx.conf') || lower.endsWith('.nginx')) {
    return StreamLanguage.define(nginx);
  }

  switch (ext) {
    case 'json':
    case 'json5':
      return json();
    case 'yaml':
    case 'yml':
      return yaml();
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
      return javascript();
    case 'ts':
      return javascript({ typescript: true });
    case 'tsx':
      return javascript({ typescript: true, jsx: true });
    case 'py':
      return python();
    case 'md':
    case 'markdown':
    case 'mdx':
      return markdown();
    case 'sh':
    case 'bash':
    case 'zsh':
    case 'fish':
    case 'bashrc':
    case 'profile':
      return StreamLanguage.define(shell);
    case 'toml':
    case 'ini':
    case 'conf':
    case 'cfg':
    case 'env':
      return StreamLanguage.define(toml);
    case 'sql':
      return StreamLanguage.define(standardSQL);
    default:
      return null;
  }
}
