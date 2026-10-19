import { describe, expect, it } from 'vitest';
import { buildSudoCommand, detectSudoRetry, isRootPromptLine, outputIndicatesPermissionDenied } from './sudoRetry';

const base = { exitCode: undefined, atRootPrompt: false } as const;

describe('detectSudoRetry', () => {
  it('suggests sudo for a plain permission error', () => {
    expect(
      detectSudoRetry({ ...base, command: 'cat /etc/shadow', output: 'cat: /etc/shadow: Permission denied' })
    ).toEqual({ sudoCommand: 'sudo cat /etc/shadow' });
  });

  it.each([
    'mkdir: cannot create directory ‘/opt/x’: Permission denied',
    'rm: cannot remove ‘/x’: Operation not permitted',
    'E: Could not open lock file /var/lib/dpkg/lock-frontend - open (13: Permission denied)',
    'Are you root?',
    'This command must be run as root',
    'Failed to restart nginx.service: Interactive authentication required.',
  ])('recognises %s', (output) => {
    expect(outputIndicatesPermissionDenied(output)).toBe(true);
  });

  it('ignores ssh authentication failures', () => {
    expect(
      detectSudoRetry({ ...base, command: 'ls', output: 'user@host: Permission denied (publickey,password).' })
    ).toBeNull();
  });

  it.each(['ssh host', 'scp a b:', 'git push', 'sudo cat /x', 'su -', 'doas ls', '/usr/bin/ssh host'])(
    'skips excluded command %s',
    (command) => {
      expect(detectSudoRetry({ ...base, command, output: 'x: Permission denied' })).toBeNull();
    }
  );

  it.each([
    ['a newline', 'cat /x\nrm -rf ~'],
    ['a carriage return', 'cat /x\rrm -rf ~'],
    ['an escape character', 'cat /x\u001b[2K'],
    ['a bidi override', 'cat /x\u202e'],
    ['a zero-width space', 'cat\u200b /x'],
  ])('refuses a command containing %s', (_name, command) => {
    expect(detectSudoRetry({ ...base, command, output: 'cat: /x: Permission denied' })).toBeNull();
  });

  it('skips redirects to and from files because the shell opens them before sudo runs', () => {
    const output = 'bash: /etc/foo: Permission denied';
    expect(detectSudoRetry({ ...base, command: 'echo x > /etc/foo', output })).toBeNull();
    expect(detectSudoRetry({ ...base, command: 'sort < /etc/shadow', output })).toBeNull();
    expect(detectSudoRetry({ ...base, command: 'cat /x 2>> /var/log/y', output })).toBeNull();
  });

  it('still offers sudo when the only redirects are stderr/null redirects', () => {
    const output = 'find: /root: Permission denied';
    expect(detectSudoRetry({ ...base, command: 'find /root -name x 2>/dev/null', output })?.sudoCommand).toBe(
      'sudo find /root -name x 2>/dev/null'
    );
    expect(detectSudoRetry({ ...base, command: 'cat /x 2>&1 | less', output })).not.toBeNull();
    expect(detectSudoRetry({ ...base, command: 'cat /x &>/dev/null', output })).not.toBeNull();
  });

  it.each(['cd /root', 'source ./env', 'export A=1', 'alias ll=ls', 'type foo', 'exec ls'])(
    'skips the shell builtin %s',
    (command) => {
      expect(detectSudoRetry({ ...base, command, output: 'bash: /root: Permission denied' })).toBeNull();
    }
  );

  it.each(['cat /x; cat /y', 'cd /x && ls', 'ls /x || true'])('skips the compound line %s', (command) => {
    expect(detectSudoRetry({ ...base, command, output: 'cat: /x: Permission denied' })).toBeNull();
  });

  it.each(['npm install', 'pip install x', 'yarn add y', 'cargo build'])(
    'skips the user-scoped package tool %s',
    (command) => {
      expect(detectSudoRetry({ ...base, command, output: 'npm: /x: Permission denied' })).toBeNull();
    }
  );

  it('does not treat a firewall or sandbox "Operation not permitted" as a permission problem', () => {
    expect(
      detectSudoRetry({ ...base, command: 'ping 1.1.1.1', output: 'ping: sendto: Operation not permitted' })
    ).toBeNull();
    expect(outputIndicatesPermissionDenied('Error: EACCES: permission denied, open x')).toBe(false);
  });

  it('only counts an error near the end of the output', () => {
    const early = ['a: Permission denied', 'line 2', 'line 3', 'line 4', 'done'].join('\n');
    expect(outputIndicatesPermissionDenied(early)).toBe(false);
    expect(outputIndicatesPermissionDenied(['ok', 'cat: /x: Permission denied'].join('\n'))).toBe(true);
  });

  it('skips when already root, or when the exit code is 0', () => {
    const output = 'cat: /x: Permission denied';
    expect(detectSudoRetry({ command: 'cat /x', output, atRootPrompt: true })).toBeNull();
    expect(detectSudoRetry({ command: 'cat /x', output, exitCode: 0, atRootPrompt: false })).toBeNull();
    expect(detectSudoRetry({ command: 'cat /x', output, exitCode: 1, atRootPrompt: false })).not.toBeNull();
  });

  it('skips long output and missing command or output', () => {
    const long = Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n') + '\nx: Permission denied';
    expect(detectSudoRetry({ ...base, command: 'cat log', output: long })).toBeNull();
    expect(detectSudoRetry({ ...base, command: null, output: 'x: Permission denied' })).toBeNull();
    expect(detectSudoRetry({ ...base, command: 'ls', output: null })).toBeNull();
  });

  it('keeps pipes so the shown command is exactly what runs', () => {
    expect(
      detectSudoRetry({ ...base, command: 'cat /x | head', output: 'cat: /x: Permission denied' })?.sudoCommand
    ).toBe('sudo cat /x | head');
  });
});

describe('buildSudoCommand / isRootPromptLine', () => {
  it('trims the command', () => {
    expect(buildSudoCommand('  ls /root  ')).toBe('sudo ls /root');
  });

  it('detects a root prompt', () => {
    expect(isRootPromptLine('[root@host ~]# ')).toBe(true);
    expect(isRootPromptLine('user@host:~$ ')).toBe(false);
    expect(isRootPromptLine('root@host:~$ ')).toBe(true);
    expect(isRootPromptLine('root@host ~ % ')).toBe(true);
    expect(isRootPromptLine('alun@fedora in ~')).toBe(false);
  });
});
