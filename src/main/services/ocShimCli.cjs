/**
 * sshs3 oc CLI Shim for OpenShift / Kubernetes.
 *
 * Provides built-in support for `oc login`, `oc whoami`, and `oc project`
 * in sshs3's local terminal sessions without requiring the external `oc`
 * binary to be installed on the host machine.
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const https = require('node:https');
const http = require('node:http');
const { spawnSync } = require('node:child_process');
const { URL } = require('node:url');

function parseArgs(args) {
  const result = {
    command: args[0] || '',
    token: '',
    server: '',
    insecureSkipTlsVerify: false,
    namespace: '',
    username: '',
    extra: [],
  };

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--insecure-skip-tls-verify' || arg === '--insecure-skip-tls-verify=true') {
      result.insecureSkipTlsVerify = true;
    } else if (arg === '--insecure-skip-tls-verify=false') {
      result.insecureSkipTlsVerify = false;
    } else if (arg.startsWith('--token=')) {
      result.token = arg.slice(8);
    } else if (arg === '--token' || arg === '-t') {
      result.token = args[++i] || '';
    } else if (arg.startsWith('--server=')) {
      result.server = arg.slice(9);
    } else if (arg === '--server') {
      result.server = args[++i] || '';
    } else if (arg.startsWith('--namespace=')) {
      result.namespace = arg.slice(12);
    } else if (arg === '--namespace' || arg === '-n') {
      result.namespace = args[++i] || '';
    } else if (arg.startsWith('--username=') || arg.startsWith('-u=')) {
      result.username = arg.split('=')[1];
    } else if (arg === '--username' || arg === '-u') {
      result.username = args[++i] || '';
    } else if (/^https?:\/\//i.test(arg) && !result.server) {
      result.server = arg;
    } else {
      result.extra.push(arg);
    }
  }

  return result;
}

function requestJson(serverUrl, reqPath, token, insecureSkipTlsVerify) {
  return new Promise((resolve, reject) => {
    let fullUrl;
    try {
      fullUrl = new URL(reqPath, serverUrl);
    } catch {
      return reject(new Error('Invalid cluster URL: ' + serverUrl));
    }

    const isHttps = fullUrl.protocol === 'https:';
    const client = isHttps ? https : http;

    const req = client.request(
      fullUrl,
      {
        method: 'GET',
        headers: {
          Authorization: 'Bearer ' + token,
          Accept: 'application/json',
          'User-Agent': 'sshs3-oc-shim',
        },
        rejectUnauthorized: !insecureSkipTlsVerify,
        timeout: 10000,
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          let parsed;
          try {
            parsed = JSON.parse(raw);
          } catch {
            parsed = raw;
          }
          resolve({ statusCode: res.statusCode || 0, body: parsed });
        });
      }
    );

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Connection timed out after 10s'));
    });

    req.on('error', (err) => {
      if (
        err.code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
        err.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
        err.code === 'CERT_HAS_EXPIRED'
      ) {
        reject(
          new Error(
            'Certificate validation failed (' +
              err.code +
              '). Use --insecure-skip-tls-verify=true if using self-signed certs.'
          )
        );
      } else {
        reject(err);
      }
    });

    req.end();
  });
}

function getKubeConfigPath() {
  return process.env.KUBECONFIG || path.join(os.homedir(), '.kube', 'config');
}

function loadKubeConfigDoc(k8sModule) {
  const kubePath = getKubeConfigPath();
  let doc = {
    apiVersion: 'v1',
    kind: 'Config',
    clusters: [],
    users: [],
    contexts: [],
    'current-context': '',
  };

  if (fs.existsSync(kubePath)) {
    try {
      const raw = fs.readFileSync(kubePath, 'utf8');
      if (k8sModule && typeof k8sModule.loadYaml === 'function') {
        doc = k8sModule.loadYaml(raw) || doc;
      } else {
        try {
          doc = JSON.parse(raw);
        } catch {
          // Keep default
        }
      }
    } catch {
      // Keep default
    }
  }

  doc.clusters = Array.isArray(doc.clusters) ? doc.clusters : [];
  doc.users = Array.isArray(doc.users) ? doc.users : [];
  doc.contexts = Array.isArray(doc.contexts) ? doc.contexts : [];
  return doc;
}

function saveKubeConfigDoc(doc, k8sModule) {
  const kubePath = getKubeConfigPath();
  const kubeDir = path.dirname(kubePath);
  if (!fs.existsSync(kubeDir)) {
    fs.mkdirSync(kubeDir, { recursive: true, mode: 0o700 });
  }

  let text;
  if (k8sModule && typeof k8sModule.dumpYaml === 'function') {
    text = k8sModule.dumpYaml(doc);
  } else {
    text = JSON.stringify(doc, null, 2);
  }

  const tmpPath = kubePath + '.tmp-' + Date.now();
  fs.writeFileSync(tmpPath, text, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmpPath, kubePath);
}

function findExternalOc() {
  const pathEnv = process.env.PATH || '';
  const parts = pathEnv.split(path.delimiter);
  for (const dir of parts) {
    if (!dir || dir.includes('.sshs3') || dir.includes('sshs3')) continue;
    const candidate = path.join(dir, process.platform === 'win32' ? 'oc.exe' : 'oc');
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return candidate;
      }
    } catch {
      // Ignore
    }
  }
  return null;
}

async function handleLogin(parsed, k8sModule) {
  if (!parsed.server) {
    process.stderr.write('Error: Server URL is required (e.g. --server=https://api.cluster.com:6443)\n');
    process.exit(1);
  }
  if (!parsed.token) {
    process.stderr.write('Error: Token is required (e.g. --token=sha256~...)\n');
    process.exit(1);
  }

  let normalizedServer = parsed.server.trim();
  if (!/^https?:\/\//i.test(normalizedServer)) {
    normalizedServer = 'https://' + normalizedServer;
  }
  normalizedServer = normalizedServer.replace(/\/+$/, '');

  process.stdout.write('Connecting to ' + normalizedServer + '...\n');

  let username = parsed.username || '';
  let isOpenShift = false;
  const projects = [];

  try {
    const userRes = await requestJson(
      normalizedServer,
      '/apis/user.openshift.io/v1/users/~',
      parsed.token,
      parsed.insecureSkipTlsVerify
    );
    if (userRes.statusCode === 200) {
      isOpenShift = true;
      if (userRes.body && userRes.body.metadata && userRes.body.metadata.name) {
        username = userRes.body.metadata.name;
      }
    } else if (userRes.statusCode === 401 || userRes.statusCode === 403) {
      process.stderr.write('error: The token provided was rejected by the cluster (HTTP ' + userRes.statusCode + ')\n');
      process.exit(1);
    }
  } catch (err) {
    if (err.message && err.message.includes('Certificate validation failed')) {
      process.stderr.write('error: ' + err.message + '\n');
      process.exit(1);
    }
    // Check fallback
  }

  if (!isOpenShift) {
    try {
      const apiRes = await requestJson(normalizedServer, '/api', parsed.token, parsed.insecureSkipTlsVerify);
      if (apiRes.statusCode === 401 || apiRes.statusCode === 403) {
        process.stderr.write('error: The token provided was rejected by the cluster (HTTP ' + apiRes.statusCode + ')\n');
        process.exit(1);
      }
      if (apiRes.statusCode !== 200) {
        process.stderr.write('error: Cluster returned HTTP ' + apiRes.statusCode + '\n');
        process.exit(1);
      }
      if (!username) username = 'token-user';
    } catch (err) {
      process.stderr.write('error: Could not reach cluster: ' + (err.message || String(err)) + '\n');
      process.exit(1);
    }
  } else {
    try {
      const projRes = await requestJson(
        normalizedServer,
        '/apis/project.openshift.io/v1/projects',
        parsed.token,
        parsed.insecureSkipTlsVerify
      );
      if (projRes.statusCode === 200 && Array.isArray(projRes.body && projRes.body.items)) {
        for (const item of projRes.body.items) {
          if (item.metadata && item.metadata.name) {
            projects.push(item.metadata.name);
          }
        }
      }
    } catch {
      // Ignore
    }
  }

  if (!username) username = 'developer';

  let activeNamespace = parsed.namespace || '';
  if (!activeNamespace) {
    if (projects.length > 0) {
      const match = projects.find((p) => p === username || p.includes(username));
      activeNamespace = match || projects[0];
    } else {
      activeNamespace = 'default';
    }
  }

  const urlObj = new URL(normalizedServer);
  const hostSanitized = urlObj.hostname.replace(/\./g, '-');
  const port = urlObj.port ? ':' + urlObj.port : urlObj.protocol === 'https:' ? ':6443' : '';
  const clusterName = hostSanitized + port;
  const userName = username + '/' + clusterName;
  const contextName = activeNamespace + '/' + clusterName + '/' + username;

  const doc = loadKubeConfigDoc(k8sModule);

  // Cluster entry
  const clusterData = {
    server: normalizedServer,
  };
  if (parsed.insecureSkipTlsVerify) {
    clusterData['insecure-skip-tls-verify'] = true;
  }
  const cIdx = doc.clusters.findIndex((c) => c.name === clusterName);
  if (cIdx >= 0) {
    doc.clusters[cIdx] = { name: clusterName, cluster: { ...doc.clusters[cIdx].cluster, ...clusterData } };
  } else {
    doc.clusters.push({ name: clusterName, cluster: clusterData });
  }

  // User entry
  const uIdx = doc.users.findIndex((u) => u.name === userName);
  const uData = { token: parsed.token };
  if (uIdx >= 0) {
    doc.users[uIdx] = { name: userName, user: { ...doc.users[uIdx].user, ...uData } };
  } else {
    doc.users.push({ name: userName, user: uData });
  }

  // Context entry
  const ctxIdx = doc.contexts.findIndex((c) => c.name === contextName);
  const ctxData = { cluster: clusterName, user: userName, namespace: activeNamespace };
  if (ctxIdx >= 0) {
    doc.contexts[ctxIdx] = { name: contextName, context: { ...doc.contexts[ctxIdx].context, ...ctxData } };
  } else {
    doc.contexts.push({ name: contextName, context: ctxData });
  }

  doc['current-context'] = contextName;
  saveKubeConfigDoc(doc, k8sModule);

  process.stdout.write('\nLogged into "' + normalizedServer + '" as "' + username + '" using the token provided.\n\n');

  if (projects.length > 0) {
    process.stdout.write('You have access to the following projects:\n');
    for (const p of projects) {
      if (p === activeNamespace) {
        process.stdout.write('  * ' + p + '\n');
      } else {
        process.stdout.write('    ' + p + '\n');
      }
    }
    process.stdout.write('\nUsing project "' + activeNamespace + '".\n');
  } else {
    process.stdout.write('Using context "' + contextName + '" with namespace "' + activeNamespace + '".\n');
  }
}

function handleWhoAmI(k8sModule) {
  const doc = loadKubeConfigDoc(k8sModule);
  const currentCtx = doc['current-context'];
  if (!currentCtx) {
    process.stderr.write('error: No current context set in ' + getKubeConfigPath() + '\n');
    process.exit(1);
  }
  const ctx = doc.contexts.find((c) => c.name === currentCtx);
  if (!ctx || !ctx.context) {
    process.stderr.write('error: Context ' + currentCtx + ' not found\n');
    process.exit(1);
  }
  const user = ctx.context.user || '';
  const cleanUser = user.includes('/') ? user.split('/')[0] : user;
  process.stdout.write(cleanUser + '\n');
}

function handleProject(parsed, k8sModule) {
  const doc = loadKubeConfigDoc(k8sModule);
  const currentCtx = doc['current-context'];
  if (!currentCtx) {
    process.stderr.write('error: No current context set in ' + getKubeConfigPath() + '\n');
    process.exit(1);
  }
  const ctxIdx = doc.contexts.findIndex((c) => c.name === currentCtx);
  if (ctxIdx === -1) {
    process.stderr.write('error: Current context not found in config\n');
    process.exit(1);
  }

  const targetProject = parsed.extra[0];
  if (!targetProject) {
    const curNs = doc.contexts[ctxIdx].context?.namespace || 'default';
    const curCluster = doc.contexts[ctxIdx].context?.cluster || '';
    process.stdout.write('Using project "' + curNs + '" on server "' + curCluster + '".\n');
    return;
  }

  doc.contexts[ctxIdx].context.namespace = targetProject;
  saveKubeConfigDoc(doc, k8sModule);
  process.stdout.write('Now using project "' + targetProject + '".\n');
}

async function main() {
  const args = process.argv.slice(2);
  const parsed = parseArgs(args);

  let k8sModule = null;
  try {
    k8sModule = require('@kubernetes/client-node');
  } catch {
    // Falls back to JSON serializer if @kubernetes/client-node is not in module tree
  }

  if (parsed.command === 'login') {
    await handleLogin(parsed, k8sModule);
    return;
  }

  if (parsed.command === 'whoami') {
    handleWhoAmI(k8sModule);
    return;
  }

  if (parsed.command === 'project') {
    handleProject(parsed, k8sModule);
    return;
  }

  if (parsed.command === 'version') {
    process.stdout.write('OpenShift Client: 4.16 (sshs3 built-in shim)\n');
    return;
  }

  // Check if real oc is installed elsewhere
  const realOc = findExternalOc();
  if (realOc) {
    const res = spawnSync(realOc, args, { stdio: 'inherit' });
    process.exit(res.status ?? 0);
  }

  process.stderr.write(
    "oc: command '" +
      (parsed.command || '') +
      "' is not available because the OpenShift CLI (oc) is not installed locally.\n" +
      "sshs3 provides built-in 'oc login', 'oc whoami', and 'oc project' in this terminal, as well as full\n" +
      'graphical browsing (pods, terminals, logs, files, port forwards) in the app UI.\n' +
      'To use full oc CLI functionality, please install the OpenShift CLI binary.\n'
  );
  process.exit(1);
}

main().catch((err) => {
  process.stderr.write('error: ' + (err.message || String(err)) + '\n');
  process.exit(1);
});
