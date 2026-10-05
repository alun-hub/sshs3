# Kubernetes & OpenShift Workloads (Complete Reference)

**sshs3** provides a built-in and secure environment for inspecting, debugging and managing Kubernetes and OpenShift clusters right alongside SSH, SFTP and S3 workflows. No external add-ons or agents are required in the cluster.

---

## 1. Architecture & Security (Zero-Agent)

sshs3 communicates directly with the standard **Kubernetes API** using the credentials in your local `~/.kube/config` (or through OpenShift `oc login` token authentication):

![Kubernetes cluster view](/img/docs/k8s-clusters-view.png)

### 1.1 Cluster Discovery & Lazy Loading
- **Automatic discovery**: At startup the app automatically reads all contexts in `~/.kube/config`.
- **Live file watcher**: A file watcher (`fs.watch`) listens for changes in your kubeconfig file. If you switch the active context in the terminal (`kubectl config use-context`) or log in to a new cluster through the CLI, the tree in sshs3 updates instantly without a restart.
- **Resilient lazy loading**: Contexts, namespaces and pods are called asynchronously only when you click to expand a branch. If a cluster is offline or behind a closed VPN tunnel, it never locks up the interface or delays the app's startup.

---

## 2. Features & Detailed Usage

### 2.1 Interactive Container Exec Terminal (`tty`)
- **Purpose**: Open an interactive shell straight into a running application container for immediate debugging.
- **How it is used**:
  1. Expand your cluster → Context → Namespace → Pod.
  2. Click the container and select **Exec Terminal** (or right-click and select *Exec Shell*).
  3. Choose a shell: `sh`, `bash` or enter a custom diagnostic command.
  4. The session starts in sshs3's regular terminal and can be split into Konsole-style split panes (<kbd>Ctrl+Shift+D</kbd> / <kbd>Ctrl+Shift+E</kbd>).
- **Limits**:
  > [!WARNING]
  > **Distroless & scratch containers**: Minimal container images (such as `scratch`, distroless or stripped Go binaries) that lack a POSIX shell (`/bin/sh` or `/bin/bash`) cannot start an interactive terminal. Ephemeral debugging is recommended for these (see below).

---

### 2.2 Streaming Container Logs (Live Log Viewer)
- **Purpose**: Follow log output (stdout/stderr) in real time with search and filtering.
- **How it is used**:
  - Click **View Logs** on any container.
  - **Follow**: Streams new log lines as they are written.
  - **Tail Lines**: Choose how many lines of history to fetch initially (`50`, `100`, `500` or `1000`).
  - **Timestamps**: Turn ISO 8601 timestamps on or off on every log line.
  - **Container Switcher**: For pods with several containers (for example sidecars such as Envoy/Istio) you switch container directly in the drop-down.
  - **Previous Container Logs (`previous: true`)**:
    Tick *"Previous container instance"* to read the logs from the container instance that just crashed in `CrashLoopBackOff` or `OOMKilled`.
- **Limits**: Log history is limited by the cluster's configured log rotation policy on the nodes.

---

### 2.3 Container File Manager (`K8sPodStorageProvider`)
- **Purpose**: Browse, upload, download and edit files inside containers through the dual-pane file manager.
- **How it is used**:
  - Open the container in the left or right pane of the file manager.
  - Copy files directly between the container and your local computer, an SFTP server or an S3 bucket with drag and drop.
  - Double-click text or configuration files to open and edit them in the built-in text editor; press <kbd>Ctrl+S</kbd> to save directly into the container.
- **How it works under the hood**:
  - No agents are installed in the container. File operations are streamed through the Kubernetes `exec` protocol (`cat`, `dd`, `stat`, `rm`, `mv`, `chmod`).
- **Limits**:
  - Requires standard POSIX tools in the container (`cat`, `stat`, `chmod`).
  - Files written to non-persistent volumes (outside Persistent Volume Claims) disappear if the pod restarts.

---

### 2.4 Kubernetes Port Forwarding
- **Purpose**: Forward ports from internal pods or cluster services (ClusterIP) to your local computer.
- **How it is used**:
  1. Right-click a Pod or Service and select **Port Forward**.
  2. Enter the remote port and the desired local port (for example `8080` → `8080`).
  3. Click **Start Forwarding**.
  4. The status indicator shows transferred bytes and gives a direct link to open the service in your browser (`http://localhost:8080`).
- **Limits**: If the network to the API server drops, the port forwarding connection is broken and must be resumed.

---

### 2.5 OpenShift Support
- **`oc login` integration**:
  Click **OpenShift Login** and paste the login command from the OpenShift Web Console:
  ```bash
  oc login --token=sha256~... --server=https://api.mycluster.openshift.com:6443
  ```
  sshs3 parses the token and API URL and automatically updates your local `~/.kube/config`.
- **Projects & SCC**: Treated with full parity with standard Kubernetes namespaces.
