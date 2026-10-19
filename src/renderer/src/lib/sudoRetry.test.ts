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
    'Error: EACCES: permission denied, open /x',
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

  it('skips redirects because the shell opens the target', () => {
    expect(detectSudoRetry({ ...base, command: 'echo x > /etc/foo', output: 'bash: /etc/foo: Permission denied' })).toBeNull();
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
  });
});
