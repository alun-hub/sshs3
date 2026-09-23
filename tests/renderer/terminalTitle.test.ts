import { describe, it, expect } from 'vitest';
import {
  extractHostnameFromTitle,
  extractHostnameFromCommand,
  scanOutputForHost,
  isSameHost,
} from '../../src/renderer/src/lib/terminalTitle';

describe('terminalTitle', () => {
  describe('extractHostnameFromTitle', () => {
    it('extracts host from standard user@host: path prompts', () => {
      expect(extractHostnameFromTitle('alun@server2: ~')).toBe('server2');
      expect(extractHostnameFromTitle('root@db-prod-01: /var/log')).toBe('db-prod-01');
      expect(extractHostnameFromTitle('ubuntu@ip-10-0-0-5:~')).toBe('ip-10-0-0-5');
      expect(extractHostnameFromTitle('user@web.example.com: /var/www')).toBe('web.example.com');
    });

    it('extracts host from prompts with virtualenv or chroot', () => {
      expect(extractHostnameFromTitle('(venv) user@myhost: ~')).toBe('myhost');
      expect(extractHostnameFromTitle('(chroot) root@box-1:/')).toBe('box-1');
    });

    it('extracts host from user@host without path', () => {
      expect(extractHostnameFromTitle('alun@laptop')).toBe('laptop');
      expect(extractHostnameFromTitle('root@bastion.corp')).toBe('bastion.corp');
    });

    it('extracts host from direct ssh command in title', () => {
      expect(extractHostnameFromTitle('ssh otherhost')).toBe('otherhost');
      expect(extractHostnameFromTitle('ssh user@remote-box')).toBe('remote-box');
      expect(extractHostnameFromTitle('ssh -p 2222 user@remote-box.net')).toBe('remote-box.net');
      expect(extractHostnameFromTitle('ssh -i id_rsa jumpbox')).toBe('jumpbox');
    });

    it('extracts host from host: path prompts without user prefix', () => {
      expect(extractHostnameFromTitle('db-01: ~')).toBe('db-01');
      expect(extractHostnameFromTitle('web-prod: /etc/nginx')).toBe('web-prod');
    });

    it('extracts bare valid hostnames', () => {
      expect(extractHostnameFromTitle('gnarg')).toBe('gnarg');
      expect(extractHostnameFromTitle('srv-backup-01')).toBe('srv-backup-01');
      expect(extractHostnameFromTitle('192.168.1.50')).toBe('192.168.1.50');
      expect(extractHostnameFromTitle('prod.internal.net')).toBe('prod.internal.net');
    });

    it('returns null for non-host titles', () => {
      expect(extractHostnameFromTitle('')).toBeNull();
      expect(extractHostnameFromTitle('vim README.md')).toBeNull();
      expect(extractHostnameFromTitle('cat /etc/hosts')).toBeNull();
      expect(extractHostnameFromTitle('git commit -m "fix"')).toBeNull();
      expect(extractHostnameFromTitle('http://localhost:3000')).toBeNull();
      expect(extractHostnameFromTitle('Terminal 1')).toBeNull();
      expect(extractHostnameFromTitle('Local Shell')).toBeNull();
      expect(extractHostnameFromTitle('notes.txt: line 5')).toBeNull();
      expect(extractHostnameFromTitle('top')).toBeNull();
      expect(extractHostnameFromTitle('bash')).toBeNull();
      expect(extractHostnameFromTitle('htop')).toBeNull();
      expect(extractHostnameFromTitle('oc')).toBeNull();
      expect(extractHostnameFromTitle('helm')).toBeNull();
      expect(extractHostnameFromTitle('minikube')).toBeNull();
      expect(extractHostnameFromTitle('k9s')).toBeNull();
      expect(extractHostnameFromTitle('crc')).toBeNull();
    });
  });

  describe('isSameHost', () => {
    it('compares exact match case-insensitively', () => {
      expect(isSameHost('ServerA', 'servera')).toBe(true);
      expect(isSameHost('web-1', 'web-2')).toBe(false);
    });

    it('compares short hostname with FQDN', () => {
      expect(isSameHost('web01', 'web01.internal.corp')).toBe(true);
      expect(isSameHost('db.prod.internal', 'db')).toBe(true);
      expect(isSameHost('web01', 'web02.internal.corp')).toBe(false);
    });

    it('returns false when either host is missing', () => {
      expect(isSameHost(undefined, 'web01')).toBe(false);
      expect(isSameHost('web01', undefined)).toBe(false);
      expect(isSameHost('', '')).toBe(false);
    });
  });

  describe('extractHostnameFromCommand', () => {
    it('extracts hostname from direct ssh command', () => {
      expect(extractHostnameFromCommand('ssh gnarg')).toBe('gnarg');
      expect(extractHostnameFromCommand('ssh alun@gnarg')).toBe('gnarg');
      expect(extractHostnameFromCommand('ssh -p 22 gnarg')).toBe('gnarg');
      expect(extractHostnameFromCommand('ssh -i ~/.ssh/id_ed25519 user@gnarg.local')).toBe('gnarg.local');
      expect(extractHostnameFromCommand('ssh -o StrictHostKeyChecking=no gnarg')).toBe('gnarg');
      expect(extractHostnameFromCommand('ssh -J jumpbox gnarg')).toBe('gnarg');
    });

    it('returns null for non-ssh commands', () => {
      expect(extractHostnameFromCommand('')).toBeNull();
      expect(extractHostnameFromCommand('ls -la')).toBeNull();
      expect(extractHostnameFromCommand('git status')).toBeNull();
      expect(extractHostnameFromCommand('grep ssh file.txt')).toBeNull();
    });
  });

  describe('scanOutputForHost', () => {
    it('detects hostname from ANSI styled shell prompt', () => {
      const prompt = '\x1b[38;5;240m╭─ \x1b[38;5;75malun\x1b[38;5;240m@\x1b[38;5;110mgnarg \x1b[38;5;240min \x1b[38;5;80m~\x1b[0m';
      expect(scanOutputForHost(prompt)).toBe('gnarg');
    });

    it('detects hostname from standard bracket prompt', () => {
      expect(scanOutputForHost('[alun@gnarg ~]$ ')).toBe('gnarg');
      expect(scanOutputForHost('root@gnarg:~# ')).toBe('gnarg');
      expect(scanOutputForHost('alun@gnarg % ')).toBe('gnarg');
    });

    it('detects hostname from OSC sequences', () => {
      expect(scanOutputForHost('\x1b]0;user@gnarg: ~\x07')).toBe('gnarg');
      expect(scanOutputForHost('\x1b]7;file://gnarg/home/alun\x07')).toBe('gnarg');
      expect(scanOutputForHost('\x1b]3008;hostname=gnarg;pid=123\x1b\\')).toBe('gnarg');
    });

    it('returns null for non-prompt output', () => {
      expect(scanOutputForHost('')).toBeNull();
      expect(scanOutputForHost('total 123\n-rw-r--r-- 1 alun alun 456 Sep 20 18:00 file.txt')).toBeNull();
    });
  });
});
