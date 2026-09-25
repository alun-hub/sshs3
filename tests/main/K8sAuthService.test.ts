import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {
  parseOcLoginCommand,
  formatClusterNames,
  loginWithToken,
} from '../../src/main/services/K8sAuthService';
import { K8sShimManager } from '../../src/main/services/K8sShimManager';

describe('K8sAuthService', () => {
  describe('parseOcLoginCommand', () => {
    it('parses standard oc login command with equals signs', () => {
      const cmd = 'oc login --token=sha256~token-abc-123 --server=https://api.mycluster.example.com:6443';
      const parsed = parseOcLoginCommand(cmd);
      expect(parsed.token).toBe('sha256~token-abc-123');
      expect(parsed.server).toBe('https://api.mycluster.example.com:6443');
      expect(parsed.insecureSkipTlsVerify).toBeUndefined();
    });

    it('parses flags separated by spaces and shorthand -t', () => {
      const cmd = 'oc login --server https://api.mycluster.example.com:6443 -t sha256~short-token';
      const parsed = parseOcLoginCommand(cmd);
      expect(parsed.token).toBe('sha256~short-token');
      expect(parsed.server).toBe('https://api.mycluster.example.com:6443');
    });

    it('parses positional server URL and insecure flag', () => {
      const cmd = 'oc login https://api.cluster.org:6443 --token="sha256~quoted" --insecure-skip-tls-verify -n my-project';
      const parsed = parseOcLoginCommand(cmd);
      expect(parsed.server).toBe('https://api.cluster.org:6443');
      expect(parsed.token).toBe('sha256~quoted');
      expect(parsed.insecureSkipTlsVerify).toBe(true);
      expect(parsed.namespace).toBe('my-project');
    });

    it('handles input without leading oc login', () => {
      const cmd = '--token=sha256~raw --server=https://10.0.0.1:6443';
      const parsed = parseOcLoginCommand(cmd);
      expect(parsed.token).toBe('sha256~raw');
      expect(parsed.server).toBe('https://10.0.0.1:6443');
    });

    it('handles empty or non-string input safely', () => {
      expect(parseOcLoginCommand('')).toEqual({});
      expect(parseOcLoginCommand(null as any)).toEqual({});
    });
  });

  describe('formatClusterNames', () => {
    it('generates standard OpenShift cluster, user, and context names', () => {
      const { clusterName, userName, contextName, normalizedServer } = formatClusterNames(
        'https://api.sandbox-m2.g1.p1.openshiftapps.com:6443',
        'alun',
        'my-project'
      );

      expect(normalizedServer).toBe('https://api.sandbox-m2.g1.p1.openshiftapps.com:6443');
      expect(clusterName).toBe('api-sandbox-m2-g1-p1-openshiftapps-com:6443');
      expect(userName).toBe('alun/api-sandbox-m2-g1-p1-openshiftapps-com:6443');
      expect(contextName).toBe('my-project/api-sandbox-m2-g1-p1-openshiftapps-com:6443/alun');
    });

    it('prepends https and handles default namespace', () => {
      const { contextName } = formatClusterNames('api.example.com:6443', 'devuser');
      expect(contextName).toBe('default/api-example-com:6443/devuser');
    });
  });

  describe('loginWithToken and kubeconfig writing', () => {
    let tmpDir: string;
    let kubeConfigPath: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sshs3-auth-test-'));
      kubeConfigPath = path.join(tmpDir, 'config');
    });

    afterEach(() => {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // Ignored
      }
    });

    it('validates against cluster and writes kubeconfig entry', async () => {
      const server = http.createServer((req, res) => {
        if (req.url === '/apis/user.openshift.io/v1/users/~') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ metadata: { name: 'testuser' } }));
        } else if (req.url === '/apis/project.openshift.io/v1/projects') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ items: [{ metadata: { name: 'project-alpha' } }] }));
        } else {
          res.writeHead(404);
          res.end();
        }
      });

      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
      const address = server.address() as any;
      const serverUrl = `http://127.0.0.1:${address.port}`;

      try {
        const result = await loginWithToken({
          server: serverUrl,
          token: 'sha256~mock-token',
          kubeConfigPath,
        });

        expect(result.success).toBe(true);
        expect(result.userName).toContain('testuser');
        expect(result.namespace).toBe('project-alpha');
        expect(result.projects).toContain('project-alpha');

        // Check kubeconfig file written
        expect(fs.existsSync(kubeConfigPath)).toBe(true);
        const written = fs.readFileSync(kubeConfigPath, 'utf8');
        expect(written).toContain('testuser');
        expect(written).toContain('sha256~mock-token');
        expect(written).toContain('project-alpha');
      } finally {
        server.close();
      }
    });

    it('rejects when cluster returns 401 Unauthorized', async () => {
      const server = http.createServer((_req, res) => {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'Unauthorized' }));
      });

      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
      const address = server.address() as any;
      const serverUrl = `http://127.0.0.1:${address.port}`;

      try {
        await expect(
          loginWithToken({
            server: serverUrl,
            token: 'sha256~invalid',
            kubeConfigPath,
          })
        ).rejects.toThrow(/Authentication failed/);
      } finally {
        server.close();
      }
    });
  });
});

describe('K8sShimManager', () => {
  it('creates the oc shim script with proper permissions', () => {
    const shimDir = K8sShimManager.ensureShim();
    expect(fs.existsSync(shimDir)).toBe(true);

    if (process.platform !== 'win32') {
      const ocPath = path.join(shimDir, 'oc');
      expect(fs.existsSync(ocPath)).toBe(true);
      const stat = fs.statSync(ocPath);
      // Check executable mode
      expect((stat.mode & 0o111) !== 0).toBe(true);
      const content = fs.readFileSync(ocPath, 'utf8');
      expect(content).toContain('ELECTRON_RUN_AS_NODE=1');
      expect(content).toContain('ocShimCli.cjs');
    } else {
      const cmdPath = path.join(shimDir, 'oc.cmd');
      expect(fs.existsSync(cmdPath)).toBe(true);
    }
  });
});
