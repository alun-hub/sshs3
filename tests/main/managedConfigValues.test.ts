import { describe, it, expect } from 'vitest';
import { directiveValue, isSafeManagedDirectiveValue } from '../../src/main/ssh/managedConfigValues';
import { sanitizeSshConfigBody } from '../../src/main/services/SshNativeFileMerger';

describe('directiveValue', () => {
  it('reads the value of "Key value" and "Key=value" lines', () => {
    expect(directiveValue('  HostName web-01.example.com')).toBe('web-01.example.com');
    expect(directiveValue('HostName=web-01')).toBe('web-01');
    expect(directiveValue('HostName = "x y"  ')).toBe('"x y"');
    expect(directiveValue('Compression')).toBeUndefined();
  });
});

describe('isSafeManagedDirectiveValue', () => {
  it('accepts what sshs3 itself generates', () => {
    for (const v of ['web-01.example.com', '10.0.0.5', '::1', '[2001:db8::1]', 'i-0123456789abcdef0', 'host_name']) {
      expect(isSafeManagedDirectiveValue('hostname', v)).toBe(true);
    }
    expect(isSafeManagedDirectiveValue('port', '2222')).toBe(true);
    expect(isSafeManagedDirectiveValue('user', 'deploy')).toBe(true);
    expect(isSafeManagedDirectiveValue('proxyjump', 'jump-host')).toBe(true);
    expect(isSafeManagedDirectiveValue('proxyjump', 'ops@bastion.example.com:2222,second')).toBe(true);
    expect(isSafeManagedDirectiveValue('identityfile', '"C:/Program Files/key"')).toBe(true); // other directives: unchanged
  });

  it('rejects shell syntax in a HostName (the value ssh expands into %h)', () => {
    for (const v of ['"x$(touch m)"', 'x$(id)', 'x`id`', 'x;id', 'a&b', 'a|b', "a'b", 'a"b', 'a b', 'a\\b', 'a%hb', '', 'a>b', '-oProxyCommand=x y']) {
      expect(isSafeManagedDirectiveValue('hostname', v)).toBe(false);
    }
    expect(isSafeManagedDirectiveValue('hostname', 'x'.repeat(256))).toBe(false);
  });

  it('rejects shell syntax in Port, User and ProxyJump', () => {
    expect(isSafeManagedDirectiveValue('port', '22; id')).toBe(false);
    expect(isSafeManagedDirectiveValue('port', '123456')).toBe(false);
    expect(isSafeManagedDirectiveValue('user', 'a$(id)')).toBe(false);
    expect(isSafeManagedDirectiveValue('proxyjump', "jump';id;'")).toBe(false);
    expect(isSafeManagedDirectiveValue('proxyjump', 'a b')).toBe(false);
  });
});

describe('sanitizeSshConfigBody: values that ssh expands into shell-run commands', () => {
  // The exact payload that was reproduced in the sandbox against OpenSSH 10.5 for the SSM ProxyCommand.
  const body = ['Host i-0123456789abcdef0', '  HostName "x$(touch /scratch/marker)"', '  User deploy', '  Port 22'].join('\n');

  it('drops a quoted HostName with a command substitution and keeps the harmless lines', () => {
    const r = sanitizeSshConfigBody(body);
    expect(r.removedLines).toEqual(['  HostName "x$(touch /scratch/marker)"']);
    expect(r.body).toContain('Host i-0123456789abcdef0');
    expect(r.body).toContain('User deploy');
    expect(r.body).not.toMatch(/touch/);
  });

  it('also drops a dangerous ProxyJump, User and Port, in "Key=value" form too', () => {
    const r = sanitizeSshConfigBody(['Host h', "ProxyJump=a';id;'", 'User=a$(id)', 'Port 22;id', 'HostName=ok.example.com'].join('\n'));
    expect(r.removedLines).toHaveLength(3);
    expect(r.body).toContain('HostName=ok.example.com');
  });

  it('keeps a normal generated block untouched', () => {
    const ok = ['Host web', '    HostName web-01.example.com', '    Port 2222', '    User deploy', '    ProxyJump bastion'].join('\n');
    const r = sanitizeSshConfigBody(ok);
    expect(r.removedLines).toEqual([]);
    expect(r.body).toBe(ok);
  });
});
