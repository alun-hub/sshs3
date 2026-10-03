# Kubernetes & OpenShift Integration

sshs3 provides native Kubernetes and OpenShift management directly alongside its SSH, SFTP, and S3 capabilities. Rather than requiring external plugins, proprietary container agents, or daemonsets on your clusters, sshs3 communicates directly with the standard **Kubernetes API** using the credentials in your local `~/.kube/config` (or token authentication via OpenShift `oc login`).

---

## Automatic Cluster Discovery & Lazy Loading

- **Kubeconfig Discovery**: On launch, sshs3 automatically parses your local `~/.kube/config` and lists all discovered contexts in the Connection Manager and the "+" menu.
- **Live File Watcher**: A background file watcher listens for changes to `~/.kube/config`. Running `kubectl config use-context` or logging into new clusters via CLI immediately updates the sshs3 cluster tree without restarting.
- **Resilient Lazy Loading**: Contexts, namespaces, and workloads are only queried on demand when you expand a node. If a cluster is offline or unreachable across a VPN, it will never block the UI or delay startup.

---

## Interactive Container Exec Terminal (`tty`)

Launch interactive pseudo-terminal sessions directly into running containers:
1. In the cluster tree, expand your target Context → Namespace → Pod.
2. Select any container and click **Exec Terminal** (or right-click → *Exec Shell*).
3. Choose your preferred shell: `sh`, `bash`, or specify a custom diagnostic command.
4. The session runs inside sshs3's standard xterm/split-pane terminal interface with full support for ANSI colors, cursor keys, terminal resize events, and split panes (<kbd>Ctrl+Shift+D</kbd> / <kbd>Ctrl+Shift+E</kbd>).

---

## Real-Time Container Log Streaming

sshs3 includes a dedicated high-performance streaming log viewer for debugging microservices and containers:

- **Live Streaming (`follow`)**: Streams container `stdout` and `stderr` in real time over Kubernetes streaming sockets.
- **Configurable History (`tailLines`)**: Request the last 50, 100, 500, or 1000 lines.
- **Timestamps**: Toggle ISO 8601 timestamps on every line.
- **Container Switcher**: For multi-container pods, instantly switch between containers via the dropdown without closing the viewer.
- **Previous Container Logs**: Toggle *"Previous container instance"* (`previous: true`) to diagnose containers that have crashed with `CrashLoopBackOff` or `OOMKilled`.
- **Filtering & Search**: Live text search and regex filtering across the log buffer.

---

## Container File Explorer (`K8sPodStorageProvider`)

You can open any running container directly in sshs3's **Dual-Pane File Manager**:
- Browse container directories, view configuration files, and inspect persistent volume mounts (`/data`, `/config`).
- Download files from a container to your local disk or upload files into the container.
- Transfer files directly between a Kubernetes container and an SFTP server or S3 bucket in a single drag-and-drop operation.
- **In-App Editing**: Open and edit configuration files inside the container directly using the embedded editor.

> [!NOTE]
> Container file operations require standard POSIX utilities (`cat`, `dd`, `stat`, `rm`, `mv`, `chmod`) available in the container image. Minimal "scratch" or distroless images without a shell binary cannot support direct file browsing.

---

## Kubernetes Port Forwarding

Forward ports from pods or services to your local machine:
1. Right-click any Pod or Service in the cluster tree and select **Port Forward**.
2. Specify the remote target port and your preferred local port (e.g. `8080` → `8080`).
3. Click **Start Forwarding**.
4. The Port Forward modal displays real-time connection status and byte counters, with a direct button to open `http://localhost:<port>` in your default browser.

---

## OpenShift Support

- **`oc login` Integration**: Click **OpenShift Login** and paste an `oc login --token=... --server=...` command copied from the OpenShift Web Console. sshs3 automatically extracts the cluster URL and bearer token and updates your local kubeconfig.
- **Project & Namespace Parity**: OpenShift projects and security contexts are treated identically to native Kubernetes namespaces.
