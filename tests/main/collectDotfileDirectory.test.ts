import { describe, it, expect } from 'vitest';
import { Readable } from 'node:stream';
import { collectDotfileDirectory } from '../../src/main/dotfiles/collectDotfileDirectory';
import { defaultDotfileRemotePath } from '../../src/shared/dotfilePath';

type Node = { dir?: Record<string, Node>; text?: Buffer; link?: boolean };

function fakeProvider(root: Record<string, Node>) {
  const walk = (p: string): Node | undefined => {
    let n: Node | undefined = { dir: root };
    for (const part of p.split('/').filter(Boolean)) n = n?.dir?.[part];
    return n;
  };
  return {
    async list(p: string) {
      const n = walk(p)!;
      return Object.entries(n.dir ?? {}).map(([name, c]) => ({
        name,
        path: `${p === '/' ? '' : p}/${name}`,
        size: c.text?.length ?? 0,
        isDirectory: !!c.dir,
        isSymlink: c.link,
        permissions: '600',
      }));
    },
    async createReadStream(p: string) {
      return Readable.from([walk(p)!.text!]);
    },
  } as never;
}

describe('collectDotfileDirectory', () => {
  it('collects nested text files and skips symlinks and binaries', async () => {
    const provider = fakeProvider({
      '.kube': {
        dir: {
          config: { text: Buffer.from('a') },
          cache: { dir: { x: { text: Buffer.from('b') } } },
          bin: { text: Buffer.from([1, 0, 2]) },
          lnk: { text: Buffer.from('z'), link: true },
        },
      },
    });
    const files = await collectDotfileDirectory(provider, '/.kube');
    expect(files.map((f) => f.relPath).sort()).toEqual(['cache/x', 'config']);
    expect(files.find((f) => f.relPath === 'config')?.mode).toBe('600');
  });
});

describe('defaultDotfileRemotePath', () => {
  it('keeps the path from the first dot-segment', () => {
    expect(defaultDotfileRemotePath('/home/u/.kube/config')).toBe('~/.kube/config');
    expect(defaultDotfileRemotePath('/home/u/.config/nvim/init.vim')).toBe('~/.config/nvim/init.vim');
    expect(defaultDotfileRemotePath('/home/u/.bashrc')).toBe('~/.bashrc');
    expect(defaultDotfileRemotePath('/srv/app/settings')).toBe('~/.settings');
  });
});
