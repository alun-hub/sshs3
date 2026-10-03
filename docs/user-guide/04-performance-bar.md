# Performance Bar (Opt-In Live Metrics)

The **Performance Bar** is a lightweight live telemetry strip that sits directly above active SSH, local shell, and Kubernetes terminals.

> [!NOTE]
> The Performance Bar is **opt-in and turned off by default** to guarantee zero background overhead. You can enable it in **Settings → Performance**.

---

## Zero-Overhead Sampling Architecture

### Remote SSH Sessions
Rather than running heavy telemetry daemons, installing third-party agents, or opening secondary connections, sshs3 samples metrics over the **already open OpenSSH ControlMaster socket**:
- **Zero Login Prompts**: Because the ControlMaster socket is reused, sampling requires no second authentication, no password prompt, and no PIN/touch interaction on hardware security keys.
- **Safety Guarantees**: Each sample executes a single, read-only script querying `/proc` on Linux hosts. The command runs with `BatchMode=yes`, ensuring it can never hang, block, or prompt for credentials.
- **Windows Fallback**: On Windows (where OpenSSH does not support UNIX domain ControlMaster sockets), sshs3 utilizes a lightweight, non-interactive SSH subprocess limited to key-based/agent auth, polling at most every 10 seconds. Network latency is measured via direct TCP connect times to the SSH daemon.

### Local Shell Sessions
Measures telemetry of your local workstation:
- **Linux**: Full metric suite (CPU, RAM, load, swap, per-filesystem disk usage, network I/O, disk I/O, iowait, steal, processes, per-core utilization, page cache, uptime).
- **Windows & macOS**: CPU (total and per-core), RAM, uptime, and disk usage (plus load average on macOS).

### Kubernetes Pods & Containers
Leverages the Kubernetes `metrics.k8s.io` API directly (identical to `kubectl top pod`):
- CPU and RAM utilization calculated against container **requests and limits**.
- Pod restart counters, readiness state, pod age, and host node assignment.
- Displays *"metrics-server not available"* gracefully on clusters without metrics-server. Polling interval is throttled to at least 10s to match metrics-server scrape frequencies.

---

## Layouts and Customization

The Performance Bar supports three visual presentations configured in **Settings → Performance**:

1. **Compact Text**: Clean textual readouts (e.g. `CPU: 12% | RAM: 3.4/16 GB | Net: ↓ 1.2 MB/s ↑ 240 KB/s`).
2. **Color-Coded Gauges (Bars)**: Visual progress bars that dynamically transition through green, amber, and red thresholds.
3. **Mini Sparklines**: Real-time scrolling sparkline graphs showing immediate trends over recent samples.

### Customisable Metric Selection
You can select which specific metrics are displayed in the bar:
- CPU utilization (Total & Per-Core)
- Memory (Used, Free, Buffers/Cache)
- Load Average (Normalised against core count)
- Swap Space
- Root `/` and all mounted filesystems
- Network Traffic (Download / Upload rate)
- Disk I/O (Read / Write rate)
- Kernel metrics: `iowait`, `steal`, process count, page cache
- Round-trip ping / latency to remote host
- Update interval: Choose between 2s, 5s, 10s, or 30s.

---

## Interactive Diagnostics: Hover & 15-Minute History

### Instant Hover Tooltip
Hovering your mouse over the Performance Bar instantly triggers a detailed tooltip displaying **all** telemetry metrics for that session—including metrics not selected for the top bar—without leaving your terminal.

### 15-Minute Detailed Telemetry Modal
Clicking anywhere on the Performance Bar opens the comprehensive **Performance Diagnostics Modal**:
- **Interactive Line Charts**: Time-series graphs plotting CPU, Memory, Swap, Network, and Disk I/O for up to the last 15 minutes.
- **Real-Time Donut Gauges**:
  - CPU Breakdown (User + System / I/O Wait / Steal / Idle)
  - Memory Allocation (Used / Cached / Buffers / Free)
  - Swap Utilization
- **Per-Filesystem Capacity**: Visual bars for every mounted disk partition on the remote host.
- **Per-Container Request/Limit Gauges**: Visual indication of whether Kubernetes containers are approaching OOMKill or CPU throttling limits.
- **Stat Tiles**: Instant readouts for system uptime, network ping latency, total processes, and cluster node name.
- Data persists while the tab remains open and survives switching between tabs.
