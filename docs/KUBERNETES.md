# Kubernetes & OpenShift in sshs3

This guide explains how to use **sshs3** to inspect, manage, and debug Kubernetes and OpenShift workloads, how the underlying file access architecture works, and the technical limits regarding file access in containers and ephemeral debug containers.

---

## 1. Overview & Architecture

sshs3 provides native Kubernetes and OpenShift management directly alongside its SSH, SFTP, and S3 capabilities. Rather than requiring external plugins, proprietary container agents, or daemonsets on your clusters, sshs3 communicates directly with the standard **Kubernetes API** using the credentials in your local `~/.kube/config` (or token authentication via OpenShift `oc login`).

```
┌────────────────────────────────────────────────────────┐
│                      sshs3 UI                          │
│  Cluster Tree · Pod Terminal · Dual-Pane File Manager   │
│  Live Log Viewer · Port Forwarding · Ephemeral Debug   │
└──────────────────────────┬─────────────────────────────┘
                           │ (Typed Electron IPC)
┌──────────────────────────▼─────────────────────────────┐
│                 sshs3 Main Process                     │
│  K8sDiscoveryService  ·  K8sTerminalManager            │
│  K8sLogManager        ·  K8sPortForwardManager         │
│  K8sDebugService      ·  K8sPodStorageProvider         │
└──────────────────────────┬─────────────────────────────┘
                           │ (Kubernetes API / WebSockets)
┌──────────────────────────▼─────────────────────────────┐
│               Kubernetes API Server                    │
│  /api/v1/namespaces/{ns}/pods/{pod}/exec               │
│  /api/v1/namespaces/{ns}/pods/{pod}/log                │
│  /api/v1/namespaces/{ns}/pods/{pod}/portforward        │
│  /api/v1/namespaces/{ns}/pods/{pod}/ephemeralcontainers│
└────────────────────────────────────────────────────────┘
```

---

## 2. Key Capabilities & How to Use Them

### 2.1 Cluster Discovery & Navigation
- **Automatic Context Discovery**: On startup, sshs3 automatically parses `~/.kube/config` and lists all configured contexts in the left-hand navigation tree.
- **Live File Watcher**: A file watcher monitors `~/.kube/config` on disk (`fs.watch`), so switching contexts via CLI (`kubectl config use-context`) or adding new clusters instantly updates the tree without restarting the application.
- **Namespace & Pod Hierarchy**: Clusters expand on demand to list namespaces, workloads (Deployments, StatefulSets, DaemonSets), pods, and individual containers.

### 2.2 Interactive Pod Exec Terminals (`tty`)
- Click **"Exec Terminal"** on any running container to launch an interactive pseudo-terminal session.
- Powered by `node-pty` and `@xterm/xterm` over Kubernetes WebSocket exec streams.
- Supports full ANSI color rendering, window resizing (`resize` events sent over the WebSocket channel), and standard shell interaction (`sh`, `bash`, or a custom command).

### 2.3 Dual-Pane Pod File Explorer (`K8sPodStorageProvider`)
- Open any container directly in the **Dual-Pane File Manager**.
- Seamlessly copy, move, view, and edit files:
  - Copy between a container and your **local machine**.
  - Copy directly between a container and an **SFTP server** or an **S3 bucket**.
  - In-app file viewer and editor with live syntax highlighting and Markdown preview.
  - File permissions viewer (`chmod` calculation and modification).

### 2.4 Live Container Log Streaming
- Stream container stdout/stderr logs in real time with auto-scroll and regex text search.
- Supports inspecting crashed containers by toggling **"Previous container instance"** (`previous: true`).

### 2.5 Background Port Forwarding
- Forward ports from pods or services to your local loopback interface (`127.0.0.1`).
- Managed through the Port Forward modal with live traffic indicators and quick links to open forwarded web services in your browser.

### 2.6 Ephemeral Container Debugging (`kubectl debug`)
- Launch on-demand ephemeral diagnostic containers into running pods without restarting or redeploying them.
- Pre-configured image presets:
  - `nicolaka/netshoot` (comprehensive network diagnostics: `tcpdump`, `curl`, `dig`, `iperf3`, `nmap`)
  - `busybox:latest` / `alpine:latest` (lightweight shell and core utilities)
  - `curlimages/curl` (HTTP testing)
- Process namespace targeting (`targetContainerName`) to attach directly to an application container's process tree.

### 2.7 OpenShift Integration
- **`oc login` parser**: Paste an `oc login --token=... --server=...` command into the OpenShift login modal to automatically authenticate and write credentials into your kubeconfig.
- **CLI Shim**: An optional `oc` CLI shim (`~/.sshs3/bin`) can be injected into local terminal tabs.

---

## 3. How Pod File Access Works (`K8sPodStorageProvider`)

Understanding the file access mechanism helps clarify what is possible and where limitations arise.

### Zero-Agent Architecture
sshs3 does **not** install any background agent, sidecar, or daemon inside the container. Instead, `K8sPodStorageProvider` leverages the standard Kubernetes `exec` WebSocket subprotocol:

1. **Listing directories (`list`)**:
   sshs3 sends a non-interactive shell script over `exec` that executes `stat` (or POSIX fallbacks) to output filename, directory flag, file size, permissions, and modification timestamp (`mtime`) in a tab-delimited stream.
2. **Reading files (`readFile`, `createReadStream`)**:
   Streams file bytes over the exec stdout channel using `cat` or `dd` (for chunked byte-range requests).
3. **Writing files (`writeFile`, `createWriteStream`)**:
   Streams input bytes through stdin directly into `cat > "$targetPath"`, followed by `chmod` if permissions are specified.
4. **Modifications (`delete`, `rename`, `chmod`, `createFolder`)**:
   Executed via POSIX commands (`rm`, `mv`, `chmod`, `mkdir -p`).

---

## 4. Technical Limits & Constraints for Container File Access

Because file access relies on container runtime primitives and the Kubernetes API rather than a direct block device or SFTP subsystem, several important limitations apply:

### 4.1 Distroless & Scratch Containers (No Shell Available)
* **The Problem**: Minimalist container images built `FROM scratch` or based on distroless images (e.g. `gcr.io/distroless/static`, minimal Go/Rust binaries) contain only the application binary and **no `/bin/sh` or `/bin/bash`**.
* **The Impact**:
  * Opening the dual-pane file manager on a distroless container will fail with:
    `executable file not found in $PATH` or exit code `126`/`127`.
  * Interactive exec terminals cannot start a shell in that container.
* **The Workaround**:
  * Use **Ephemeral Containers** (see §4.2 below) to attach a diagnostic container with a shell to the pod.

### 4.2 File Access Limits in Ephemeral Containers
When using sshs3's **Debug Pod** feature (`kubectl debug`), an ephemeral container is added to the pod. However, Kubernetes isolates container filesystems:

```
Pod (Shared Network & IPC Namespace)
┌─────────────────────────────────────────────────────────────┐
│ Application Container ("app")                               │
│ └── Root Filesystem: [ /app, /etc, /var ]                   │
│                                                             │
│ Ephemeral Debug Container ("debugger-xyz", e.g. netshoot)  │
│ └── Root Filesystem: [ /bin, /usr, /lib, /tools ]           │
│                                                             │
│ Shared Volumes (e.g. emptyDir: /shared-data)                │
└─────────────────────────────────────────────────────────────┘
```

1. **Independent Filesystem Roots**:
   - Each container in a pod has its own private container root filesystem (`rootfs`).
   - Launching an ephemeral container into a pod **does NOT mount the target container's root filesystem onto the ephemeral container's `/`**.
   - If you browse the ephemeral container in sshs3's file manager, you are viewing the *ephemeral container's* filesystem (tools, binaries), not the main application's `/app` folder.

2. **Accessing Target Files via Process Namespace Sharing (`/proc/<pid>/root`)**:
   - If process namespace sharing is enabled (either via pod-level `shareProcessNamespace: true` or by setting **Target Container** in sshs3's Debug Modal), the ephemeral container can see the target container's processes.
   - You can access the target container's entire root filesystem through Linux's procfs:
     ```bash
     # Inside the ephemeral debug terminal:
     ls -la /proc/1/root/app
     cat /proc/1/root/etc/config.json
     ```
   - In `/proc/<pid>/root/`, the target container's filesystem is fully traversable.

3. **Shared Volumes**:
   - Files stored on shared volumes (such as `emptyDir`, PersistentVolumeClaims, or ConfigMaps/Secrets) mounted by both containers are directly accessible at their respective mount points.

4. **Ephemeral Containers Are Permanent**:
   - By Kubernetes design, once an ephemeral container is added to a pod spec, **it cannot be removed or stopped**. It persists in the pod specification until the entire pod is deleted.

### 4.3 Read-Only Root Filesystems (`readOnlyRootFilesystem: true`)
* If a pod's security context specifies:
  ```yaml
  securityContext:
    readOnlyRootFilesystem: true
  ```
* Any write, upload, rename, or delete operations attempted through sshs3's file manager outside of mounted writable volumes (`tmpfs` or `volumeMounts`) will fail with:
  `Read-only file system (exit code 1)`
* **Workaround**: Only write or transfer files into directories that correspond to writable volume mounts.

### 4.4 User Permissions & Security Context (`runAsUser` / `runAsNonRoot`)
* File operations executed by `K8sPodStorageProvider` run under the container's configured user identity (`runAsUser` / UID).
* If the container runs as an unprivileged user (e.g. UID `10001` or `nobody`):
  * You cannot edit or delete files owned by `root` (e.g. `/etc`, `/usr`).
  * Creating files in system directories will fail with `Permission denied`.

### 4.5 Bandwidth & Large File Transfers via Kubernetes API
* File transfers through `K8sPodStorageProvider` stream base64/binary chunks over WebSocket connections through the Kubernetes API server (`kube-apiserver`).
* **Ideal for**: Configuration files, logs, scripts, source files, and moderate data bundles (< 100 MB).
* **Not recommended for**: Multi-gigabyte database dumps or bulk file migrations. Transferring multi-gigabyte files through the API server puts unnecessary memory and CPU overhead on `kube-apiserver`. For massive transfers, consider:
  - Copying through an intermediate SFTP or S3 bucket mounted to the cluster.
  - Direct volume snapshots or dedicated object storage sync tools.

### 4.6 Required RBAC Permissions
To use sshs3's Kubernetes features, your Kubernetes ServiceAccount or kubeconfig user must have sufficient RBAC permissions:

| Feature | API Group | Resource | Required Verbs |
| :--- | :--- | :--- | :--- |
| **Cluster & Pod Browsing** | `""` (core) | `pods`, `namespaces`, `services` | `get`, `list`, `watch` |
| **Exec Terminal & File Explorer** | `""` (core) | `pods/exec` | `create` |
| **Container Log Streaming** | `""` (core) | `pods/log` | `get` |
| **Port Forwarding** | `""` (core) | `pods/portforward` | `create` |
| **Ephemeral Container Debug** | `""` (core) | `pods/ephemeralcontainers` | `get`, `patch`, `update` |

---

## 5. Best Practices & Troubleshooting

1. **Container has no shell?**
   - Inject an ephemeral container with `nicolaka/netshoot` or `alpine` targeting the application container. Use the terminal in the debug container to inspect `/proc/<pid>/root/`.
2. **Connection drops during exec or logs?**
   - The Kubernetes API server closes idle WebSocket connections after a server-configured timeout. sshs3 includes automatic keepalive guards, but corporate firewalls or ingress controllers may drop silent connections.
3. **Multiple containers in a pod?**
   - When launching the file manager or exec terminal, always verify which container you have selected in the pod hierarchy tree (e.g. `main` vs. `istio-proxy` vs. `debugger-*`).
