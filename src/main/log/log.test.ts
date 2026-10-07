import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileSink } from './FileSink';
import { createLogger, formatLine, resolveLogLevel, setLogLevel, setLogSinks } from './Logger';
import { redactString, redactValue } from './redact';

describe('redact', () => {
  it('masks sensitive keys, including nested and camelCase ones', () => {
    const out = redactValue({ host: 'h', pin: '1234', fido2Pin: '9999', nested: { passphrase: 'x', mapping: 'ok' } });
    expect(out).toEqual({ host: 'h', pin: '[redacted]', fido2Pin: '[redacted]', nested: { passphrase: '[redacted]', mapping: 'ok' } });
  });

  it('masks private keys, bearer tokens, URL credentials and KEY=value secrets', () => {
    const pem = '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaA\n-----END OPENSSH PRIVATE KEY-----';  // pragma: allowlist secret -- synthetic fixture for the redaction test
    const text = `${pem} Bearer abcdefgh12345 https://bob:hunter2@example.com SSHS3_PROXY_PASSWORD=hunter2 AKIAABCDEFGHIJKLMNOP`;  // pragma: allowlist secret -- synthetic fixture for the redaction test
    const out = redactString(text);
    for (const secret of ['b3BlbnNzaA', 'abcdefgh12345', 'hunter2', 'AKIAABCDEFGHIJKLMNOP']) {  // pragma: allowlist secret -- synthetic fixture for the redaction test
      expect(out).not.toContain(secret);
    }
  });

  it('handles errors, binary, circular and over-deep values without throwing', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const out = redactValue({ err: new Error('pw=1 SECRET_TOKEN=abc'), buf: Buffer.from('key'), circular, fn: () => 1 }) as Record<string, unknown>;
    expect(JSON.stringify(out)).not.toContain('abc');
    expect(out.buf).toBe('[binary 3 bytes]');
    expect(out).not.toHaveProperty('fn');
  });
});

describe('Logger', () => {
  let lines: string[];
  beforeEach(() => {
    lines = [];
    setLogSinks([{ write: (l) => lines.push(l) }]);
    setLogLevel('info');
  });
  afterEach(() => setLogSinks([]));

  it('filters by level and switches at runtime', () => {
    const log = createLogger('test');
    log.debug('hidden');
    log.info('shown');
    setLogLevel('debug');
    log.debug('now shown');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3} INFO {2}\[test\] shown$/);
  });

  it('keeps one record per line and never prints secrets from message or context', () => {
    const line = formatLine('warn', 'x y\n', 'a\nb password=zzz', { token: 'abc', pin: '1' });
    expect(line.split('\n')).toHaveLength(1);
    expect(line).not.toMatch(/zzz|abc|"1"/);
    expect(line).toContain('[x_y_]');
  });

  it('lets SSHS3_LOG_LEVEL override the setting', () => {
    expect(resolveLogLevel('warn', { SSHS3_LOG_LEVEL: 'DEBUG' })).toBe('debug');
    expect(resolveLogLevel('warn', {})).toBe('warn');
    expect(resolveLogLevel('bogus', {})).toBe('info');
  });

  it('never throws when a sink fails', () => {
    setLogSinks([{ write: () => { throw new Error('disk full'); } }]);
    expect(() => createLogger('t').error('boom')).not.toThrow();
  });
});

describe('FileSink', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sshs3-log-')); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('writes with private permissions and rotates at the size limit', async () => {
    const sink = new FileSink({ dir: path.join(dir, 'logs'), maxBytes: 100, maxFiles: 3 });
    for (let i = 0; i < 12; i++) sink.write(`line-${i}-${'x'.repeat(20)}`);
    await sink.flush();
    const files = fs.readdirSync(path.join(dir, 'logs')).sort();
    expect(files).toEqual(['sshs3.log', 'sshs3.log.1', 'sshs3.log.2']);
    // POSIX permission bits are not meaningful on Windows (reported as 0666/0777).
    if (process.platform !== 'win32') {
      expect(fs.statSync(path.join(dir, 'logs', 'sshs3.log')).mode & 0o777).toBe(0o600);
      expect(fs.statSync(path.join(dir, 'logs')).mode & 0o777).toBe(0o700);
    }
    expect((await sink.tail(2)).at(-1)).toContain('line-11');
  });
});
