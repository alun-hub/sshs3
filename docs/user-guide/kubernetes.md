## Kubernetes & OpenShift Workloads

**sshs3** provides deep, native Kubernetes and Red Hat OpenShift management capabilities directly from your desktop. By combining interactive container exec terminals, streaming container logs, agentless pod file exploration, and live `kubectl debug` ephemeral troubleshooting containers, DevOps engineers can diagnose production issues with unprecedented speed.

![Kubernetes Clusters View](/img/docs/k8s-clusters-view.png)

---

## 1. Automatic Cluster Discovery & Kubeconfig Watching

### Feature: Live Kubeconfig Synchronization

#### 🎯 Purpose
Deliver instant access to all configured clusters, namespaces, pods, and containers without manual setup, and automatically reflect changes when new clusters are added via CLI.

#### 🛠️ How to Use
1. Open the Connection Manager (<kbd>Ctrl+Shift+O</kbd>) or click the "+" menu in the tab bar.
2. Select **Kubernetes & OpenShift**.
3. All contexts from your workstation's `~/.kube/config` display in an expandable tree (`Cluster → Namespace → Pod → Container`).
4. Running `kubectl config use-context` or logging into new clusters via CLI immediately updates the sshs3 cluster tree in real time!

#### ⚠️ Limitations & Caveats
- If a cluster relies on external CLI credential plugins (e.g. AWS EKS `aws eks get-token` or Azure AKS `kubelogin`), the corresponding CLI tool must be installed and executable in `$PATH`.

#### ⚙️ Technical Internals & Architecture
Monitors `~/.kube/config` via `fs.watch`. To guarantee sub-500ms application launch times, `@kubernetes/client-node` is strictly **lazy-loaded**: the library loads only when the user expands or connects to a Kubernetes resource.

---

## 2. Interactive Container Exec & Streaming Logs

![Interactive Container Exec](/img/ks8.png)

### Feature: WebSocket-Backed Exec & Live Log Viewer with Auto-Reconnect

#### 🎯 Purpose
Provide full interactive terminal sessions inside running containers directly within sshs3's split-pane layout without requiring external terminal windows, alongside resilient live log streaming that automatically recovers when containers restart.

#### 🛠️ How to Use
- **Launch Container Terminal**: Select a container in the tree and click **Exec** (or double-click it). Choose the shell binary (`/bin/sh`, `/bin/bash`, or custom). The session opens in a normal terminal tab that can be split (<kbd>Ctrl+Shift+D</kbd> / <kbd>Ctrl+Shift+E</kbd>).
- **Stream Container Logs**: Select a container and click **Logs**. The logs open in a dedicated tab with a top toolbar:
  - **Auto-reconnect**: If the container restarts or crashes, sshs3 automatically pauses, calculates an exponential backoff countdown, and reconnects to the stream without requiring you to reopen the tab. If the pod itself was deleted and recreated (e.g. by a Deployment rollout or OpenShift DeploymentConfig), sshs3 automatically detects the newly created replacement pod and switches the stream to it.
  - **Previous Logs (kubectl logs -p)**: Click **Previous** in the toolbar to inspect the logs of the last terminated/crashed container instance. If the container has not yet crashed, sshs3 provides clear guidance and a 1-click **Live Logs** switch button.
  - **Live CPU & Memory Metrics**: Click **Metrics** in the toolbar to toggle a live resource telemetry card showing real-time CPU (millicores) and memory consumption alongside container limits.
  - **Restart Pod**: Click **Restart Pod** directly from the log toolbar (or right-click the pod in the connection tree) to delete the pod and trigger its controller to spin up a clean instance.
  - **Log Search & Timestamps**: Search log output in real time with <kbd>Ctrl+F</kbd> (<kbd>Enter</kbd> / <kbd>Shift+Enter</kbd> for next / previous match), and toggle RFC3339 timestamps with the **Timestamps** button.

#### ⚠️ Limitations & Caveats
- Exec requires a shell binary (`sh`, `bash`) inside the container. For minimal distroless images, exec fails with `executable file not found in $PATH` (use *Ephemeral Debug* below!).
- Streaming previous logs requires at least one prior restart (`restartCount > 0`).

#### ⚙️ Technical Internals & Architecture
`K8sTerminalManager` establishes a WebSocket/SPDY exec connection to the Kubernetes API server `/exec` endpoint. `K8sLogManager` streams chunked HTTP logs directly via `@kubernetes/client-node` into an xterm.js instance with an attached `SearchAddon` and `FitAddon`. Reconnection watches pod phases and matches deployment prefixes (`findReplacementPod`) to preserve uninterrupted logging during cluster rollouts.

---

## 3. Kubernetes Port Forwarding

### Feature: Local Loopback Tunneling with Auto-Reconnect & Live Byte Counters

#### 🎯 Purpose
Access private pod endpoints, internal database instances, or cluster microservices directly from local desktop tools (Postman, DBeaver, web browser) without defining public Ingress routes, with resilience against pod rollouts.

#### 🛠️ How to Use
1. Select a pod or container in the cluster tree and click **Port Forward into pod** (or **Port Forward to this container**).
2. Specify the **Container port** (e.g. `5432` for Postgres, `8080` for web apps) and the **Local port**.
3. Start the forward.
4. The Port Forwarding view displays connection state, local address (`127.0.0.1:<port>`), and real-time inbound/outbound transfer rates (KB/s, MB/s) with total transferred byte counters.
5. **Auto-Reconnect on Pod Restart / Rollout**: If the target pod terminates or is replaced during a deployment rollout, sshs3 automatically searches for the new controller-managed replacement pod and re-targets the active TCP forwarding tunnel without interrupting your workstation's local listening port.

#### ⚠️ Limitations & Caveats
- Forwarded ports remain active only while sshs3 remains running.
- If the local port is already bound by another application on your workstation, the forward fails.

#### ⚙️ Technical Internals & Architecture
Utilizes the Kubernetes API server `/portforward` subresource over SPDY/HTTP2, tunneling bidirectional TCP sockets directly to the target pod via local loopback sockets bound strictly to `127.0.0.1`. When pod connections encounter `404 Not Found`, `K8sPortForwardManager` queries replacement pods matching the controller's label/name prefix and re-targets subsequent connections transparently.

---

## 4. Agentless Pod File Explorer (`K8sPodStorageProvider`)

### Feature: Browse & Edit Files Inside Running Pods

#### 🎯 Purpose
Allow engineers to inspect generated application configs, crash dumps, or log files inside a running pod using the standard dual-pane file manager without installing SSH servers or debug agents inside the container.

#### 🛠️ How to Use
1. Select a container in the cluster tree and click **Files** (**Browse container filesystem**).
2. The pod opens as a pane in the dual-pane file manager.
3. Browse directory trees, download files to your workstation, upload files, modify permissions via `chmod`, or edit files directly using your local desktop IDE!

#### ⚠️ Limitations & Caveats
- Requires a POSIX `sh` and basic utilities (`stat`, `cat`, `dd`, `mkdir`, `rm`, `mv`, `chmod`) inside the container; distroless images have none of them (see [section 7](#7-pod-file-access-limits--rbac)).
- File modifications inside the container are ephemeral unless writing to a mounted PersistentVolume.

#### ⚙️ Technical Internals & Architecture
`K8sPodStorageProvider` (`src/main/storage/K8sPodStorageProvider.ts`) implements `IStorageProvider`. It runs short non-interactive `sh -c` scripts over the exec API and pipes bytes directly into `TransferPipeline`; no agent is installed in the container.

---

## 5. Live Ephemeral Pod Debugging (`kubectl debug`)

When a container crashes, enters a CrashLoopBackOff state, or is built as a stripped distroless image lacking `curl`, `tcpdump`, or `strace`, traditional exec fails.

![Ephemeral Pod Debugging](/img/k8s-debug.png)

### Feature: Non-Disruptive Ephemeral Debug Containers

#### 🎯 Purpose
Debug production containers in real time by attaching a dedicated diagnostic container directly to the running pod's network and process namespace without restarting the application.

#### 🛠️ How to Use
1. Select a pod and click **Debug** (**Attach ephemeral debug container (kubectl debug)**). The **Attach Debug Container** dialog opens.
2. Select a preconfigured diagnostic profile:
   - **Netshoot**: Complete network troubleshooting suite (`tcpdump`, `curl`, `iperf`, `dig`, `mtr`, `socat`).
   - **RHEL Support Tools**: Enterprise system debugging (`strace`, `gdb`, `sysstat`, `lsof`, `ubi9`).
   - **BusyBox / Curl / Ubuntu**: Lightweight shells and utilities.
3. Click **Attach Debugger**. sshs3 injects the debug container and automatically opens an interactive terminal sharing the target container's process namespace (`targetContainerName`).

![Kubernetes Settings](/img/docs/settings-k8s.png)

#### ⚠️ Limitations & Caveats
- Requires Kubernetes 1.25+ (EphemeralContainers feature is GA).
- Cluster RBAC policies must grant `patch` on the `pods/ephemeralcontainers` subresource.
- Once added, an ephemeral container cannot be removed individually; it terminates when the parent pod is evicted.

#### ⚙️ Technical Internals & Architecture
Sends a strategic merge `PATCH` request to `/api/v1/namespaces/{ns}/pods/{name}/ephemeralcontainers`. By configuring `targetContainerName`, Linux PID namespace sharing is activated, allowing utilities like `strace -p <pid>` in the debug container to inspect processes running inside the target container.

---

## 6. Built-In OpenShift Login & CLI Shim

For enterprise environments running Red Hat OpenShift:

### Feature: Web Console Token Authentication & CLI Shim

#### 🎯 Purpose
Authenticate against OpenShift clusters via web console tokens without requiring manual installation of Red Hat's official `oc` binary on the workstation.

#### 🛠️ How to Use
1. Navigate to *Settings → Kubernetes & Debug* and check **Enable OpenShift Support**.
2. In the OpenShift Web Console, click your username and select **Copy Login Command**.
3. In sshs3, click **OpenShift Login** and paste the command (e.g. `oc login --token=sha256~... --server=https://api.openshift.example.com:6443`).
4. sshs3 authenticates and adds the cluster context to `~/.kube/config`.
5. In local shell tabs, commands like `oc whoami`, `oc project`, and `oc login` work immediately thanks to sshs3's built-in CLI shim!

#### 🌐 Browser sign-in (no token to copy)
When you enter the API server URL, sshs3 checks whether the cluster has OpenShift's built-in OAuth server. If it does, the switch at the top of the dialog (always visible; browser sign-in stays disabled with an explanation until the cluster is detected) lets you choose **Sign in with browser** (the default) or **Use a token**. Only the chosen method is shown: browser sign-in hides the token and paste fields, and the token method hides the browser sign-in. Clusters without the OAuth server only offer the token form. In browser mode press <kbd>Enter</kbd> in any field to start the sign-in:

1. sshs3 opens your default browser at the cluster's login page. Whatever identity provider the cluster uses (for example Keycloak) handles the sign-in, including single sign-on and MFA.
2. After you log in, the browser returns to a temporary local address (`http://127.0.0.1:<port>/callback`) that only sshs3 listens on.
3. sshs3 exchanges the result for a token, stores it in `~/.kube/config` exactly like the pasted-token flow, and adds the cluster to the tree.

<kbd>Esc</kbd> or **Cancel** abandons a pending sign-in; it also times out after 5 minutes. If anything goes wrong, switch to **Use a token**, which works as before.

**Supported:** OpenShift / OKD **4.13 or newer** with the built-in OAuth server (any identity provider behind it). This is the same flow as `oc login --web`.

**Not offered (token form only):** OpenShift older than 4.13, clusters using direct external OIDC authentication (4.19+) instead of the built-in OAuth server, clusters where the `openshift-cli-client` OAuth client has been removed, and plain Kubernetes (which is unchanged).

**Checking a new cluster (smoke test):** enter the server URL and confirm the **Sign in with browser** switch appears; sign in; confirm the cluster shows up in the tree and `oc whoami` in a local tab prints your user.

> The flow follows the OpenShift source code (library-go / `oc`), but has not yet been tested against a live cluster. Please report the OpenShift version if it does not work for you.

#### 💾 Saved cluster profiles & project limit
- **Save as profile** (on by default) remembers the cluster (name, server, TLS option and project) after a successful sign-in. The token itself is never stored in the profile; it only lives in `~/.kube/config`.
- A saved cluster shows its profile name in the tree. **Sign in** next to it reopens the dialog prefilled, which is also how you refresh an expired token or edit the profile. The trash button removes only the profile; the kubeconfig entry stays.
- A profile whose kubeconfig entry has gone is listed as **not signed in** until you sign in again. You can keep several profiles, one per cluster.
- If you fill in **Default Project / Namespace**, the tree for that cluster shows only that project instead of every project on the cluster. Leave it empty to list all projects you can access.
- Profiles are stored locally in `k8s-profiles.json` and also take part in **encrypted profile sync** (they travel with the topology password; only the name, server, project and TLS option are synced, never a token or your kubeconfig context). After a pull on another device, the cluster shows as **not signed in** until you sign in there.

#### 👥 Shared clusters in Team Vaults
- When a Team Vault is unlocked, its shared clusters appear in a **team section** at the top of the Kubernetes tab. Locked vaults are only counted: unlock them in the SSH or S3 tab first.
- **Sign in** on a shared cluster opens the login dialog prefilled and saves the result as *your own* profile (an existing personal profile for the same server and project is reused). Tokens are never shared.
- Any unlocked member can add, edit or remove a shared cluster with the **+**, pencil and trash buttons. Removing one removes it for the whole team, while members keep their own profiles and kubeconfig entries.
- To share a cluster you already saved, use the team icon on its row (it asks which team when you are in several).
- Shared clusters are flat (no folders). Members on an older sshs3 version do not know about them and may drop them the next time they change that team's vault, so update everyone before sharing.

#### ⚠️ Limitations & Caveats
- Opt-in feature enabled under settings.
- Changing a profile's project creates a new kubeconfig context (`<project>/<cluster>/<user>`); the old one stays in `~/.kube/config`.
- Token lifetime is governed by the OpenShift OAuth server (typically 24 hours). Browser sign-in does not renew it silently; sign in again when it expires.
- Browser sign-in needs a browser on the same machine that can reach `http://127.0.0.1`; local firewall or proxy policies that block loopback traffic make it time out.

#### ⚙️ Technical Internals & Architecture
Parses cluster URL and SHA256 tokens, verifies identity against OpenShift APIs, and updates kubeconfig. An internal binary directory containing a lightweight Node.js CLI shim (`ocShimCli.cjs`) is prepended to `$PATH` for local shell processes.

---

## 7. Pod File Access Limits & RBAC

### How pod file access works
sshs3 installs no agent, sidecar or daemon in the container. Each operation is a short non-interactive script sent over the standard Kubernetes `exec` WebSocket:
- **List / stat**: a shell loop that runs `stat` and prints name, type, size, mode and `mtime` as a tab-separated stream.
- **Read**: `cat`, or `dd` for byte ranges.
- **Write**: stdin piped into `cat > file`, then `chmod` if a mode is given.
- **Delete / rename / chmod / create folder**: `rm`, `mv`, `chmod`, `mkdir -p`.

### Limits
- **Distroless and `scratch` images have no shell.** The file manager and Exec fail with `executable file not found in $PATH` (or exit code 126/127). Attach an ephemeral debug container instead (section 5).
- **An ephemeral container has its own root filesystem.** Browsing it in the file manager shows the debug image's `/bin`, `/usr` and so on, not the application's files. With process namespace sharing (pod-level `shareProcessNamespace: true`, or a **Target Container** in the debug dialog), the target's filesystem is reachable through procfs from the debug terminal:
  ```bash
  ls -la /proc/1/root/app
  cat /proc/1/root/etc/config.json
  ```
  Volumes mounted in both containers (`emptyDir`, PVCs, ConfigMaps, Secrets) are visible at their mount points.
- **Ephemeral containers cannot be removed.** They stay in the pod spec until the pod is deleted.
- **`readOnlyRootFilesystem: true`**: writes, uploads, renames and deletes outside writable volume mounts fail with `Read-only file system`.
- **Container user**: operations run as the container's user. With `runAsUser` / `runAsNonRoot` (for example UID 10001) files owned by root cannot be changed and writes to system directories fail with `Permission denied`.
- **Large transfers**: data streams through `kube-apiserver`, which suits configs, logs, scripts and bundles up to roughly 100 MB. For multi-gigabyte dumps use object storage or volume snapshots instead.
- **Idle connections**: the API server, corporate firewalls and ingress controllers may close silent WebSockets for exec and logs.
- **Several containers per pod**: check which container (`main`, `istio-proxy`, `debugger-*`) you selected before opening Exec or Files.

### Required RBAC
The cluster tree lists namespaces and pods only (not Deployments or Services), and port forwards target pods.

| Feature | API group / resource | Verbs |
| :--- | :--- | :--- |
| Cluster tree, pod inspector, events | core: `namespaces`, `pods`, `events` | `get`, `list` |
| Exec terminal and file explorer | core: `pods/exec` | `create` |
| Log streaming | core: `pods/log` | `get` |
| Port forwarding | core: `pods/portforward` | `create` |
| Ephemeral debug container | core: `pods/ephemeralcontainers` | `patch` |
| Restart Pod | core: `pods` | `delete` |
| Metrics (performance bar; `kubectl top` equivalent) | `metrics.k8s.io`: `pods` | `get`, `list` |

---

## 8. Troubleshooting & Diagnostics Runbook

| Symptom / Error Message | Probable Root Cause | Corrective Action |
| :--- | :--- | :--- |
| `executable file not found in $PATH` | Container is distroless and lacks `/bin/sh` | Use **Debug** (**Attach Debug Container**) to attach a Netshoot or BusyBox diagnostic container. |
| `pods/ephemeralcontainers is forbidden` | RBAC role lacks permission for ephemeral containers | Contact your cluster administrator to obtain `patch` RBAC rights on `pods/ephemeralcontainers`. |
| Cluster missing from tree view | Context missing in `~/.kube/config` | Run `kubectl config get-contexts` or import the cluster via the OpenShift login modal. |
| Port forward disconnects after 5 minutes | Cluster API server closed idle connection | Reconnect via the Port Forwarding manager; sshs3 features automatic reconnect logic. |
