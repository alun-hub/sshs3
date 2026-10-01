import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  parseArgs,
  requestJson,
  getKubeConfigPath,
  loadKubeConfigDoc,
  saveKubeConfigDoc,
  findExternalOc,
  handleLogin,
  handleWhoAmI,
  handleProject,
  main,
} = require('../../src/main/services/ocShimCli.cjs');

describe('ocShimCli.cjs', () => {
  const origEnv = { ...process.env };
  const origArgv = [...process.argv];
  let tempDir: string;
  let tempKubeConfig: string;

  beforeEach(() => {
    process.env = { ...origEnv };
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-shim-test-'));
    tempKubeConfig = path.join(tempDir, 'config');
    process.env.KUBECONFIG = tempKubeConfig;
  });

  afterEach(() => {
    process.env = { ...origEnv };
    process.argv = [...origArgv];
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  describe('parseArgs', () => {
    it('parses flags and short options correctly', () => {
      const parsed = parseArgs([
        'login',
        '--server=https://api.k8s.local:6443',
        '--token=sha256~token123',
        '-n',
        'my-namespace',
        '-u',
        'testuser',
        '--insecure-skip-tls-verify=true',
      ]);

      expect(parsed.command).toBe('login');
      expect(parsed.server).toBe('https://api.k8s.local:6443');
      expect(parsed.token).toBe('sha256~token123');
      expect(parsed.namespace).toBe('my-namespace');
      expect(parsed.username).toBe('testuser');
      expect(parsed.insecureSkipTlsVerify).toBe(true);
    });

    it('parses flags with space-separated values and url as positional', () => {
      const parsed = parseArgs([
        'login',
        'https://cluster.example.com:6443',
        '--token',
        'tok456',
        '--insecure-skip-tls-verify=false',
        'extra-arg',
      ]);

      expect(parsed.command).toBe('login');
      expect(parsed.server).toBe('https://cluster.example.com:6443');
      expect(parsed.token).toBe('tok456');
      expect(parsed.insecureSkipTlsVerify).toBe(false);
      expect(parsed.extra).toEqual(['extra-arg']);
    });
  });

  describe('KubeConfig read and write', () => {
    it('returns custom path from KUBECONFIG environment variable', () => {
      process.env.KUBECONFIG = '/custom/kube/config';
      expect(getKubeConfigPath()).toBe('/custom/kube/config');
    });

    it('returns default skeleton when kubeconfig file does not exist', () => {
      const doc = loadKubeConfigDoc(null);
      expect(doc.apiVersion).toBe('v1');
      expect(doc.clusters).toEqual([]);
      expect(doc.contexts).toEqual([]);
      expect(doc.users).toEqual([]);
      expect(doc['current-context']).toBe('');
    });

    it('saves and reloads config using JSON when k8sModule is null', () => {
      const doc = {
        apiVersion: 'v1',
        kind: 'Config',
        clusters: [{ name: 'cl-1', cluster: { server: 'https://test.com' } }],
        users: [{ name: 'u-1', user: { token: 'tok' } }],
        contexts: [{ name: 'ctx-1', context: { cluster: 'cl-1', user: 'u-1' } }],
        'current-context': 'ctx-1',
      };

      saveKubeConfigDoc(doc, null);
      expect(fs.existsSync(tempKubeConfig)).toBe(true);

      const loaded = loadKubeConfigDoc(null);
      expect(loaded['current-context']).toBe('ctx-1');
      expect(loaded.clusters).toHaveLength(1);
    });

    it('supports YAML load and dump when k8sModule provides them', () => {
      const fakeK8s = {
        loadYaml: (str: string) => JSON.parse(str),
        dumpYaml: (obj: any) => JSON.stringify(obj),
      };

      const doc = {
        apiVersion: 'v1',
        kind: 'Config',
        clusters: [{ name: 'yaml-cl', cluster: { server: 'https://yaml.com' } }],
        users: [],
        contexts: [],
        'current-context': '',
      };

      saveKubeConfigDoc(doc, fakeK8s);
      const loaded = loadKubeConfigDoc(fakeK8s);
      expect(loaded.clusters[0].name).toBe('yaml-cl');
    });
  });

  describe('requestJson', () => {
    it('makes HTTP requests and parses JSON responses', async () => {
      const server = http.createServer((req, res) => {
        expect(req.headers['authorization']).toBe('Bearer test-token');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', user: 'alice' }));
      });

      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const port = (server.address() as any).port;

      const result = await requestJson(`http://127.0.0.1:${port}`, '/api/user', 'test-token', true);
      expect(result.statusCode).toBe(200);
      expect(result.body).toEqual({ status: 'ok', user: 'alice' });

      server.close();
    });

    it('rejects on invalid URL', async () => {
      await expect(requestJson('::invalid-url::', '/path', 'token', false)).rejects.toThrow(
        'Invalid cluster URL'
      );
    });
  });

  describe('findExternalOc', () => {
    it('ignores sshs3 directories in PATH and returns null when no external oc exists', () => {
      process.env.PATH = `${tempDir}/.sshs3/bin:${tempDir}/sshs3-mock`;
      const found = findExternalOc();
      expect(found).toBeNull();
    });
  });

  describe('handleWhoAmI', () => {
    it('prints clean username from current context', () => {
      const doc = {
        apiVersion: 'v1',
        kind: 'Config',
        clusters: [{ name: 'c1', cluster: { server: 'https://c1.com' } }],
        users: [{ name: 'developer/c1', user: { token: 't' } }],
        contexts: [
          { name: 'ctx1', context: { cluster: 'c1', user: 'developer/c1', namespace: 'default' } },
        ],
        'current-context': 'ctx1',
      };
      saveKubeConfigDoc(doc, null);

      let stdout = '';
      const origStdoutWrite = process.stdout.write;
      process.stdout.write = ((data: string) => {
        stdout += data;
        return true;
      }) as any;

      try {
        handleWhoAmI(null);
        expect(stdout.trim()).toBe('developer');
      } finally {
        process.stdout.write = origStdoutWrite;
      }
    });

    it('exits with error when no current context is set', () => {
      saveKubeConfigDoc({ apiVersion: 'v1', contexts: [] }, null);

      let stderr = '';
      let exitCode: number | null = null;
      const origStderrWrite = process.stderr.write;
      const origExit = process.exit;

      process.stderr.write = ((data: string) => {
        stderr += data;
        return true;
      }) as any;
      process.exit = ((code: number) => {
        exitCode = code;
        throw new Error(`process.exit: ${code}`);
      }) as any;

      try {
        expect(() => handleWhoAmI(null)).toThrow('process.exit: 1');
        expect(stderr).toContain('error: No current context set');
        expect(exitCode).toBe(1);
      } finally {
        process.stderr.write = origStderrWrite;
        process.exit = origExit;
      }
    });
  });

  describe('handleProject', () => {
    it('prints current project when no target project argument is given', () => {
      const doc = {
        apiVersion: 'v1',
        kind: 'Config',
        contexts: [
          { name: 'ctx1', context: { cluster: 'my-cluster', user: 'dev', namespace: 'my-project' } },
        ],
        'current-context': 'ctx1',
      };
      saveKubeConfigDoc(doc, null);

      let stdout = '';
      const origStdoutWrite = process.stdout.write;
      process.stdout.write = ((data: string) => {
        stdout += data;
        return true;
      }) as any;

      try {
        handleProject({ extra: [] }, null);
        expect(stdout).toContain('Using project "my-project" on server "my-cluster"');
      } finally {
        process.stdout.write = origStdoutWrite;
      }
    });

    it('switches current context namespace when project argument is specified', () => {
      const doc = {
        apiVersion: 'v1',
        kind: 'Config',
        contexts: [
          { name: 'ctx1', context: { cluster: 'my-cluster', user: 'dev', namespace: 'old-project' } },
        ],
        'current-context': 'ctx1',
      };
      saveKubeConfigDoc(doc, null);

      let stdout = '';
      const origStdoutWrite = process.stdout.write;
      process.stdout.write = ((data: string) => {
        stdout += data;
        return true;
      }) as any;

      try {
        handleProject({ extra: ['new-project'] }, null);
        expect(stdout).toContain('Now using project "new-project"');
        const updated = loadKubeConfigDoc(null);
        expect(updated.contexts[0].context.namespace).toBe('new-project');
      } finally {
        process.stdout.write = origStdoutWrite;
      }
    });
  });

  describe('handleLogin', () => {
    it('exits with error if server or token are missing', async () => {
      let stderr = '';
      const origStderrWrite = process.stderr.write;
      const origExit = process.exit;
      process.stderr.write = ((data: string) => {
        stderr += data;
        return true;
      }) as any;
      process.exit = ((code: number) => {
        throw new Error(`process.exit: ${code}`);
      }) as any;

      try {
        await expect(handleLogin({ server: '', token: '' }, null)).rejects.toThrow('process.exit: 1');
        expect(stderr).toContain('Server URL is required');
      } finally {
        process.stderr.write = origStderrWrite;
        process.exit = origExit;
      }
    });

    it('successfully logs into an OpenShift cluster and updates kubeconfig', async () => {
      const server = http.createServer((req, res) => {
        if (req.url === '/apis/user.openshift.io/v1/users/~') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ metadata: { name: 'os-admin' } }));
        } else if (req.url === '/apis/project.openshift.io/v1/projects') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              items: [{ metadata: { name: 'prod-env' } }, { metadata: { name: 'dev-env' } }],
            })
          );
        } else {
          res.writeHead(404);
          res.end();
        }
      });

      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const port = (server.address() as any).port;

      let stdout = '';
      const origStdoutWrite = process.stdout.write;
      process.stdout.write = ((data: string) => {
        stdout += data;
        return true;
      }) as any;

      try {
        await handleLogin(
          {
            server: `http://127.0.0.1:${port}`,
            token: 'sha256~validtoken',
            insecureSkipTlsVerify: true,
            namespace: '',
            username: '',
          },
          null
        );

        expect(stdout).toContain('Logged into');
        expect(stdout).toContain('os-admin');
        expect(stdout).toContain('prod-env');

        const doc = loadKubeConfigDoc(null);
        expect(doc.clusters.length).toBe(1);
        expect(doc.users.length).toBe(1);
        expect(doc.users[0].user.token).toBe('sha256~validtoken');
        expect(doc.contexts.length).toBe(1);
        expect(doc['current-context']).toBeDefined();
      } finally {
        process.stdout.write = origStdoutWrite;
        server.close();
      }
    });

    it('falls back to vanilla Kubernetes cluster when OpenShift user API is not available', async () => {
      const server = http.createServer((req, res) => {
        if (req.url === '/apis/user.openshift.io/v1/users/~') {
          res.writeHead(404);
          res.end();
        } else if (req.url === '/api') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ versions: ['v1'] }));
        } else {
          res.writeHead(404);
          res.end();
        }
      });

      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const port = (server.address() as any).port;

      let stdout = '';
      const origStdoutWrite = process.stdout.write;
      process.stdout.write = ((data: string) => {
        stdout += data;
        return true;
      }) as any;

      try {
        await handleLogin(
          {
            server: `http://127.0.0.1:${port}`,
            token: 'k8s-service-account-token',
            insecureSkipTlsVerify: true,
            namespace: 'custom-ns',
            username: '',
          },
          null
        );

        expect(stdout).toContain('token-user');
        const doc = loadKubeConfigDoc(null);
        expect(doc.contexts[0].context.namespace).toBe('custom-ns');
      } finally {
        process.stdout.write = origStdoutWrite;
        server.close();
      }
    });
  });

  describe('main CLI dispatch', () => {
    it('handles version subcommand', async () => {
      process.argv = ['node', 'ocShimCli.cjs', 'version'];
      let stdout = '';
      const origStdoutWrite = process.stdout.write;
      process.stdout.write = ((data: string) => {
        stdout += data;
        return true;
      }) as any;

      try {
        await main();
        expect(stdout).toContain('OpenShift Client: 4.16');
      } finally {
        process.stdout.write = origStdoutWrite;
      }
    });
  });
});
