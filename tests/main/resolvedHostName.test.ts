import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  configureResolvedHostNameForTests,
  isSafeResolvedHostName,
  parseResolvedHostName,
  resolveHostNamePin,
} from '../../src/main/ssh/resolvedHostName';

const out = (hostname: string) => `user ops\nhostname ${hostname}\nport 22\nidentityfile ~/.ssh/id_ed25519\n`;

describe('parseResolvedHostName', () => {
  it('reads the hostname line of ssh -G output', () => {
    expect(parseResolvedHostName(out('10.0.3.7'))).toBe('10.0.3.7');
    expect(parseResolvedHostName('hostname db.example.com\r\nport 22\r\n')).toBe('db.example.com');
  });
  it('takes the first one and ignores other lines that merely mention hostname', () => {
    expect(parseResolvedHostName('hostname a.example.com\nhostname b.example.com\n')).toBe('a.example.com');
    expect(parseResolvedHostName('hostkeyalias hostname\nproxycommand echo hostname x\nport 22\n')).toBeUndefined();
  });
  it('is undefined when there is no usable line', () => {
    expect(parseResolvedHostName('')).toBeUndefined();
    expect(parseResolvedHostName('port 22\nuser ops\n')).toBeUndefined();
    expect(parseResolvedHostName('hostname\n')).toBeUndefined();
    expect(parseResolvedHostName('hostname a b\n')).toBeUndefined(); // two words: not a host name
  });
});

describe('isSafeResolvedHostName', () => {
  it('accepts host names and IP literals', () => {
    for (const v of ['10.0.3.7', 'db.example.com', 'db-1_a.example.com', '::1', '[::1]', 'fe80::1', 'localhost']) expect(isSafeResolvedHostName(v)).toBe(true);
  });
  it('refuses shell syntax, spaces, a leading dash, empty and over-long values', () => {
    for (const v of ['x$(id)', 'a;b', 'a`b`', 'a b', 'a|b', 'a&b', 'a>b', "a'b", 'a"b', 'a\\b', 'a%h', '-oProxyCommand=x', '-v', '', 'a'.repeat(256), undefined, 5, null]) {
      expect(isSafeResolvedHostName(v)).toBe(false);
    }
  });
});

describe('resolveHostNamePin', () => {
  let now = 1_000_000;
  const run = vi.fn<(args: string[]) => string>();
  beforeEach(() => {
    now = 1_000_000;
    run.mockReset();
    configureResolvedHostNameForTests({ runner: run, clock: () => now });
  });

  it('pins the host name ssh resolves for an ssh_config alias, so the alias keeps working through a proxy', () => {
    run.mockReturnValue(out('10.0.3.7'));
    expect(resolveHostNamePin({ host: 'prod-db', username: 'ops', port: 2222 })).toBe('10.0.3.7');
    expect(run).toHaveBeenCalledWith(['-G', '-p', '2222', '--', 'ops@prod-db']);
  });

  it('asks about the destination exactly as the connection will, with the default port and without a user', () => {
    run.mockReturnValue(out('db.example.com'));
    resolveHostNamePin({ host: 'db.example.com' });
    expect(run).toHaveBeenCalledWith(['-G', '-p', '22', '--', 'db.example.com']);
  });

  it('keeps the profile host when ssh resolves it to itself', () => {
    run.mockReturnValue(out('db.example.com'));
    expect(resolveHostNamePin({ host: 'db.example.com', username: 'a' })).toBe('db.example.com');
  });

  it('falls back to the profile host when the resolved value could carry shell syntax (a hostile synced HostName)', () => {
    for (const hostile of ['x$(touch /tmp/pwned)', 'a;rm', '`id`', 'a|b', '-oProxyCommand=evil', 'a'.repeat(300), 'a&b']) {
      configureResolvedHostNameForTests({ runner: run, clock: () => now });
      run.mockReturnValue(`hostname ${hostile}\n`);
      expect(resolveHostNamePin({ host: 'prod-db', username: 'ops' })).toBe('prod-db');
    }
  });

  it('falls back to the profile host when ssh -G fails, times out, is missing or prints nothing useful', () => {
    run.mockImplementationOnce(() => { throw Object.assign(new Error('spawnSync ssh ETIMEDOUT'), { code: 'ETIMEDOUT' }); });
    expect(resolveHostNamePin({ host: 'a.example.com' })).toBe('a.example.com');
    run.mockImplementationOnce(() => { throw Object.assign(new Error('spawnSync ssh ENOENT'), { code: 'ENOENT' }); });
    expect(resolveHostNamePin({ host: 'b.example.com' })).toBe('b.example.com');
    run.mockReturnValueOnce('');
    expect(resolveHostNamePin({ host: 'c.example.com' })).toBe('c.example.com');
    run.mockReturnValueOnce('port 22\n');
    expect(resolveHostNamePin({ host: 'd.example.com' })).toBe('d.example.com');
  });

  it('runs ssh -G once per destination for a minute, whatever the answer was (Match exec commands must not run per spawn)', () => {
    run.mockReturnValue(out('10.0.3.7'));
    expect(resolveHostNamePin({ host: 'prod-db', username: 'ops' })).toBe('10.0.3.7');
    now += 59_000;
    expect(resolveHostNamePin({ host: 'prod-db', username: 'ops' })).toBe('10.0.3.7');
    expect(run).toHaveBeenCalledTimes(1);
    now += 2_000;
    run.mockReturnValue(out('10.0.3.8')); // the config changed
    expect(resolveHostNamePin({ host: 'prod-db', username: 'ops' })).toBe('10.0.3.8');
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('remembers a failure for a minute too, so a slow or broken ssh -G is not retried for every spawn', () => {
    run.mockImplementation(() => { throw new Error('timeout'); });
    resolveHostNamePin({ host: 'a.example.com' });
    resolveHostNamePin({ host: 'a.example.com' });
    resolveHostNamePin({ host: 'a.example.com' });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('keeps destinations apart: another user or port is another question (Match user / Match host)', () => {
    run.mockImplementation((args) => out(args.includes('ops@prod-db') ? '10.0.3.7' : '10.9.9.9'));
    expect(resolveHostNamePin({ host: 'prod-db', username: 'ops' })).toBe('10.0.3.7');
    expect(resolveHostNamePin({ host: 'prod-db', username: 'other' })).toBe('10.9.9.9');
    expect(resolveHostNamePin({ host: 'prod-db', username: 'ops', port: 2222 })).toBe('10.0.3.7');
    expect(run).toHaveBeenCalledTimes(3);
  });

  it('does not grow without bound', () => {
    run.mockReturnValue(out('x.example.com'));
    for (let i = 0; i < 500; i++) resolveHostNamePin({ host: `h${i}.example.com` });
    run.mockClear();
    resolveHostNamePin({ host: 'h499.example.com' }); // recent: still cached
    expect(run).not.toHaveBeenCalled();
    resolveHostNamePin({ host: 'h0.example.com' }); // the oldest were dropped
    expect(run).toHaveBeenCalledTimes(1);
  });
});

/**
 * The parsing above is checked against what OpenSSH really prints: a temporary config with an alias, a token, a hostile
 * value and a broken line, read with the real `ssh -G` (skipped where ssh is not installed). Nothing here reads the
 * developer's own ~/.ssh/config: every call passes -F with the temporary file.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const sshAvailable = (() => {
  try {
    execFileSync('ssh', ['-V'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!sshAvailable)('against the real ssh -G', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ssh-g-'));
  const good = path.join(dir, 'config');
  const bad = path.join(dir, 'broken');
  fs.writeFileSync(
    good,
    ['Host prod-db', '  HostName 10.0.3.7', 'Host tok-*', '  HostName %h.corp.example', 'Host shouty', '  HostName MiXeD.Example.COM', 'Host evil', '  HostName "x$(touch /tmp/ssh-g-pwned)"', ''].join('\n')
  );
  fs.writeFileSync(bad, 'Host x\n  HostName a b\n');
  const runWith = (file: string) => (args: string[]) => execFileSync('ssh', ['-F', file, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 });

  it('resolves an alias, expands tokens and lower-cases, like the real connection would', () => {
    configureResolvedHostNameForTests({ runner: runWith(good) });
    expect(resolveHostNamePin({ host: 'prod-db', username: 'ops' })).toBe('10.0.3.7');
    expect(resolveHostNamePin({ host: 'tok-web' })).toBe('tok-web.corp.example');
    expect(resolveHostNamePin({ host: 'shouty' })).toBe('mixed.example.com');
    expect(resolveHostNamePin({ host: 'plain.example.com' })).toBe('plain.example.com'); // not an alias: itself
  });

  it('never returns the hostile value, and never runs it', () => {
    configureResolvedHostNameForTests({ runner: runWith(good) });
    expect(resolveHostNamePin({ host: 'evil' })).toBe('evil');
    expect(fs.existsSync('/tmp/ssh-g-pwned')).toBe(false);
  });

  it('falls back to the profile host when the config is broken (ssh -G exits 255)', () => {
    configureResolvedHostNameForTests({ runner: runWith(bad) });
    expect(resolveHostNamePin({ host: 'x' })).toBe('x');
  });
});
