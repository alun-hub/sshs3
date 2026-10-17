import { describe, it, expect } from 'vitest';
import {
  detectFileType,
  getFileExtension,
  getLanguageLabel,
  resolvePathDetails,
  truncateSnippet,
} from '../../src/renderer/src/lib/terminalPathPreview';

describe('terminalPathPreview', () => {
  it('extracts correct file extensions', () => {
    expect(getFileExtension('/var/log/nginx/access.log')).toBe('log');
    expect(getFileExtension('src/components/Terminal.tsx')).toBe('tsx');
    expect(getFileExtension('.env')).toBe('env');
    expect(getFileExtension('.gitignore')).toBe('gitignore');
    expect(getFileExtension('/app/Dockerfile')).toBe('dockerfile');
    expect(getFileExtension('image.PNG')).toBe('png');
    expect(getFileExtension('no_ext')).toBe('');
  });

  it('detects file categories accurately', () => {
    expect(detectFileType('/images/logo.png')).toBe('image');
    expect(detectFileType('/src/index.ts')).toBe('code');
    expect(detectFileType('/etc/nginx/nginx.conf')).toBe('config');
    expect(detectFileType('/etc/app/config.yaml')).toBe('config');
    expect(detectFileType('README.md')).toBe('markdown');
    expect(detectFileType('bundle.tar.gz')).toBe('archive');
    expect(detectFileType('/var/log/syslog')).toBe('unknown');
    expect(detectFileType('/var/log/')).toBe('directory');
  });

  it('provides friendly language labels', () => {
    expect(getLanguageLabel('app.ts')).toBe('TypeScript');
    expect(getLanguageLabel('config.json')).toBe('JSON');
    expect(getLanguageLabel('vector.svg')).toBe('SVG Vector');
    expect(getLanguageLabel('folder/')).toBe('Directory');
  });

  it('resolves path details including ~ expansion and parents', () => {
    const details = resolvePathDetails('~/projects/sshs3/package.json', '/home/alun');
    expect(details.basename).toBe('package.json');
    expect(details.fullPath).toBe('/home/alun/projects/sshs3/package.json');
    expect(details.parentDir).toBe('/home/alun/projects/sshs3');
    expect(details.isDir).toBe(false);
    expect(details.category).toBe('config');
    expect(details.label).toBe('JSON');

    const dirDetails = resolvePathDetails('/var/log/', '/home/alun');
    expect(dirDetails.isDir).toBe(true);
    expect(dirDetails.category).toBe('directory');
    expect(dirDetails.basename).toBe('log');
  });

  it('truncates snippets with line count and width limits', () => {
    const longText = Array.from({ length: 30 }, (_, i) => `Line ${i + 1}`).join('\n');
    const snippet = truncateSnippet(longText, 5);
    expect(snippet.split('\n')).toHaveLength(5);
    expect(snippet).toContain('Line 5');
    expect(snippet).not.toContain('Line 6');

    const longLine = 'a'.repeat(200);
    const lineSnippet = truncateSnippet(longLine, 1, 50);
    expect(lineSnippet).toHaveLength(51); // 50 chars + ellipsis
    expect(lineSnippet.endsWith('…')).toBe(true);
  });
});
