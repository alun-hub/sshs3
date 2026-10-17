import { describe, it, expect } from 'vitest';
import { findPaths, findUrls } from '../../src/renderer/src/lib/terminalLinks';

describe('terminalLinks - findPaths', () => {
  it('finds standalone filenames with extensions in ls -l style output', () => {
    const text = '-rw-r--r-- 1 alun alun 1234 Oct 17 15:00 index.html';
    const matches = findPaths(text);
    expect(matches).toHaveLength(1);
    expect(matches[0].text).toBe('index.html');
  });

  it('finds multiple files on different or same lines', () => {
    const text = 'Files: todo.html, test.txt, windows.png and styles.css.';
    const matches = findPaths(text);
    const names = matches.map((m) => m.text);
    expect(names).toEqual(['todo.html', 'test.txt', 'windows.png', 'styles.css']);
  });

  it('finds absolute and home paths', () => {
    const text = 'cat /etc/nginx/nginx.conf or ~/todo.html';
    const matches = findPaths(text);
    expect(matches.map((m) => m.text)).toEqual(['/etc/nginx/nginx.conf', '~/todo.html']);
  });

  it('finds relative paths with slashes and directory paths', () => {
    const text = './build.sh ../parent/config.json src/components/App.tsx src/lib/';
    const matches = findPaths(text);
    expect(matches.map((m) => m.text)).toEqual([
      './build.sh',
      '../parent/config.json',
      'src/components/App.tsx',
      'src/lib/',
    ]);
  });

  it('matches dotfiles and well-known extensionless files', () => {
    const text = '.bashrc .gitignore Dockerfile Makefile';
    const matches = findPaths(text);
    expect(matches.map((m) => m.text)).toEqual([
      '.bashrc',
      '.gitignore',
      'Dockerfile',
      'Makefile',
    ]);
  });

  it('ignores IP addresses, version numbers, permissions and word pairs', () => {
    const text = 'total 16 -rw-r--r-- 192.168.1.1 v1.2.3 0.96.7 and/or 1/2';
    const matches = findPaths(text);
    expect(matches).toHaveLength(0);
  });

  it('preserves line and col suffixes in match length', () => {
    const text = 'Error in src/index.ts:42:15';
    const matches = findPaths(text);
    expect(matches).toHaveLength(1);
    expect(matches[0].text).toBe('src/index.ts');
  });

  it('matches single-quoted and double-quoted filenames with spaces (e.g. GNU ls output)', () => {
    const text = "-rw-r--r-- 1 alun alun 0 Oct 17 17:28 'windows 11.png' \"My Project Plan.pdf\"";
    const matches = findPaths(text);
    expect(matches).toHaveLength(2);
    expect(matches[0].text).toBe('windows 11.png');
    expect(matches[0].length).toBe("'windows 11.png'".length);
    expect(matches[1].text).toBe('My Project Plan.pdf');
    expect(matches[1].length).toBe('"My Project Plan.pdf"'.length);
  });

  it('matches quoted absolute paths and paths with line numbers', () => {
    const text = "See '/home/alun/My Documents/report.txt':12:4";
    const matches = findPaths(text);
    expect(matches).toHaveLength(1);
    expect(matches[0].text).toBe('/home/alun/My Documents/report.txt');
    expect(matches[0].length).toBe("'/home/alun/My Documents/report.txt':12:4".length);
  });

  it('matches backslash-escaped paths with spaces', () => {
    const text = 'cat /var/log/my\\ service\\ error.log and windows\\ 11.png';
    const matches = findPaths(text);
    expect(matches).toHaveLength(2);
    expect(matches[0].text).toBe('/var/log/my service error.log');
    expect(matches[1].text).toBe('windows 11.png');
  });
});

describe('terminalLinks - findUrls', () => {
  it('finds URLs correctly', () => {
    const text = 'Visit https://github.com/alun-hub/sshs3 for details.';
    const matches = findUrls(text);
    expect(matches).toHaveLength(1);
    expect(matches[0].url).toBe('https://github.com/alun-hub/sshs3');
  });
});
