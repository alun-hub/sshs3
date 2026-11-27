import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

const SCRIPT = path.resolve(__dirname, '../../scripts/store-build.sh');

// The script is bash and talks to GitHub through `gh`. A stand-in `gh` that records its arguments lets the tests see
// exactly what would be sent, without touching GitHub. (Skipped on Windows: the script is not run there.)
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sshs3-store-build-'));
const log = path.join(dir, 'gh.log');
fs.writeFileSync(
  path.join(dir, 'gh'),
  `#!/usr/bin/env bash
echo "$*" >> "$FAKE_GH_LOG"
case "$1" in
  auth) exit "\${FAKE_GH_AUTH:-0}" ;;
  api)
    case "$*" in
      *matching-refs*) printf '%b' "\${FAKE_GH_REFS-}"; exit "\${FAKE_GH_LIST:-0}" ;;
    esac
    exit "\${FAKE_GH_TAG:-0}" ;;
  workflow)
    case "$2" in
      view) exit "\${FAKE_GH_WORKFLOW:-0}" ;;
      run) exit "\${FAKE_GH_RUN:-0}" ;;
    esac ;;
  run) echo "\${FAKE_GH_URL-https://github.com/alun-hub/sshs3/actions/runs/123}" ;;
esac
`,
  { mode: 0o755 }
);
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const run = (args: string[], env: Record<string, string> = {}) => {
  const result = spawnSync('bash', [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${dir}${path.delimiter}${process.env.PATH}`, FAKE_GH_LOG: log, SSHS3_STORE_POLL_SECONDS: '0', ...env },
  });
  const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : [];
  return { status: result.status, out: `${result.stdout}${result.stderr}`, calls };
};
const dispatched = (calls: string[]) => calls.filter((c) => c.startsWith('workflow run'));

describe.skipIf(process.platform === 'win32')('scripts/store-build.sh', () => {
  beforeEach(() => fs.rmSync(log, { force: true }));

  it('--dry-run says what it would do and starts nothing', () => {
    const { status, out, calls } = run(['--dry-run', '--tag', 'v0.98.6']);
    expect(status).toBe(0);
    expect(out).toContain('gh workflow run store-build.yml --ref v0.98.6 -f submit=false');
    expect(dispatched(calls)).toEqual([]);
  });

  it('builds the tag and never submits it', () => {
    const { status, out, calls } = run(['--tag', 'v0.98.6']);
    expect(status).toBe(0);
    expect(dispatched(calls)).toEqual(['workflow run store-build.yml --repo alun-hub/sshs3 --ref v0.98.6 -f submit=false']);
    expect(calls.join('\n')).not.toContain('submit=true');
    expect(out).toContain('https://github.com/alun-hub/sshs3/actions/runs/123');
    expect(out).toContain('Not submitted');
  });

  it('prints a submit command that runs from master, in the same repository, with the tag as an input', () => {
    const { out } = run(['--tag', 'v0.98.6']);
    expect(out).toContain(
      'gh workflow run store-build.yml --repo alun-hub/sshs3 --ref master -f tag=v0.98.6 -f submit=true'
    );
    const workflow = fs.readFileSync(path.resolve(__dirname, '../../.github/workflows/store-build.yml'), 'utf8');
    for (const input of ['tag', 'submit']) expect(workflow).toMatch(new RegExp(`^      ${input}:$`, 'm'));
  });

  it('keeps an overridden repository in the submit command', () => {
    const { out } = run(['--tag', 'v0.98.6'], { SSHS3_GH_REPO: 'someone/fork' });
    expect(out).toContain('gh workflow run store-build.yml --repo someone/fork --ref master -f tag=v0.98.6 -f submit=true');
  });

  it('without --tag builds the highest release tag on GitHub, by version number', () => {
    const refs = ['v0.9.0', 'v0.98.10', 'v0.98.9', 'v0.99.0-rc1', 'vnext'].map((t) => `refs/tags/${t}`).join('\\n');
    const { status, calls } = run([], { FAKE_GH_REFS: refs });
    expect(status).toBe(0);
    expect(dispatched(calls)).toEqual(['workflow run store-build.yml --repo alun-hub/sshs3 --ref v0.98.10 -f submit=false']);
  });

  it.each([
    ['the tags cannot be listed', { FAKE_GH_LIST: '1' }, 'cannot list the tags'],
    ['there is no release tag', { FAKE_GH_REFS: 'refs/tags/vnext' }, 'has no release tag'],
  ])('without --tag stops when %s', (_label, env, message) => {
    const { status, out, calls } = run([], env as Record<string, string>);
    expect(status).toBe(1);
    expect(out).toContain(message);
    expect(dispatched(calls)).toEqual([]);
  });

  it('names the workflow page when the run cannot be found, and still succeeds', () => {
    const { status, out } = run(['--tag', 'v0.98.6'], { FAKE_GH_URL: '' });
    expect(status).toBe(0);
    expect(out).toContain('actions/workflows/store-build.yml');
  });

  it.each(['v1.2', 'master', '0.98.6', 'v0.98.6; touch pwned', 'v0.98.6 -f submit=true', 'v0.98.6-rc1'])(
    'refuses %j as a tag and starts nothing',
    (tag) => {
      const { status, out, calls } = run(['--tag', tag]);
      expect(status).not.toBe(0);
      expect(out).toContain('is not a release tag');
      expect(dispatched(calls)).toEqual([]);
    }
  );

  it('stops when gh is not logged in', () => {
    const { status, out, calls } = run(['--tag', 'v0.98.6'], { FAKE_GH_AUTH: '1' });
    expect(status).toBe(1);
    expect(out).toContain('not logged in');
    expect(dispatched(calls)).toEqual([]);
  });

  it('stops when the workflow cannot be found', () => {
    const { status, out, calls } = run(['--tag', 'v0.98.6'], { FAKE_GH_WORKFLOW: '1' });
    expect(status).toBe(1);
    expect(out).toContain('cannot find the workflow');
    expect(dispatched(calls)).toEqual([]);
  });

  it('stops when the tag has not been pushed', () => {
    const { status, out, calls } = run(['--tag', 'v0.98.6'], { FAKE_GH_TAG: '1' });
    expect(status).toBe(1);
    expect(out).toContain('is not on alun-hub/sshs3');
    expect(dispatched(calls)).toEqual([]);
  });

  it('reports a failed dispatch', () => {
    const { status, out } = run(['--tag', 'v0.98.6'], { FAKE_GH_RUN: '1' });
    expect(status).toBe(1);
    expect(out).toContain('could not start store-build.yml for v0.98.6');
  });

  it('does not check that the tag is on GitHub in a dry run (deploy.sh asks before the tag is pushed)', () => {
    const { status, calls } = run(['--dry-run', '--tag', 'v0.98.6'], { FAKE_GH_TAG: '1' });
    expect(status).toBe(0);
    expect(calls.some((c) => c.startsWith('api '))).toBe(false);
  });
});

// The guard lives in the workflow file itself: run from master, it cannot be changed by the tag that is built.
describe('store-build.yml submission guard', () => {
  const workflow = fs.readFileSync(path.resolve(__dirname, '../../.github/workflows/store-build.yml'), 'utf8').replace(/\r\n/g, '\n');
  const buildJob = workflow.slice(workflow.indexOf('\n  store:\n'), workflow.indexOf('\n  submit:\n'));

  it('refuses to submit a tag that is not part of master', () => {
    expect(buildJob).toContain('fetch-depth: 0');
    expect(buildJob).toContain('git merge-base --is-ancestor HEAD refs/remotes/origin/master');
    expect(buildJob).toMatch(/if \(\$env:SUBMIT -eq 'true' -and -not \$onMaster\) \{ throw /);
  });

  it('checks before any step runs code of the tag', () => {
    const check = buildJob.indexOf('- name: Check the release tag');
    expect(check).toBeGreaterThan(-1);
    // Nothing between the checkout and the check, and every npm command after it.
    expect(buildJob.slice(0, check).match(/^ {6}- /gm)).toHaveLength(1);
    expect(buildJob.slice(0, check)).not.toMatch(/\bnpm\b|\bnpx\b|scripts\//);
    expect(buildJob.indexOf('run: npm ci')).toBeGreaterThan(check);
  });

  it('runs the submit job only when the build job succeeded', () => {
    expect(workflow.slice(workflow.indexOf('\n  submit:\n'))).toContain('needs: store');
    expect(workflow.slice(workflow.indexOf('\n  submit:\n'))).toContain('if: ${{ inputs.submit }}');
  });
});
