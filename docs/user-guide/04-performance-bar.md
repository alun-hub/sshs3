# Performance Bar & System Diagnostics

The **Performance Bar** is a streamlined, real-time telemetry strip that sits directly above active SSH, local shell and Kubernetes terminals in **sshs3**. It gives instant insight into the health of the machine without loading the server or requiring external monitoring agents.

---

## 1. Live Telemetry Bar in the Terminal

Here you see the active performance bar at the top of a terminal session:

![Live Performance Bar](/img/docs/terminal-metrics.png)

> [!NOTE]
> **Opt-in by default**: The performance bar is off by default to guarantee absolutely no unwanted background traffic or resource use. Enable it under **Settings → Performance**.

---

## 2. How Sampling Works (Zero Extra Logins)

### 2.1 SSH over OpenSSH ControlMaster (Linux)
Telemetry is sampled directly over the **already established ControlMaster socket**:
- **No extra logins**: Reuses the existing cryptographic tunnel; never requires a new password, a new passphrase, and **no extra PIN or touch of hardware keys (FIDO2/YubiKey)**.
- **Safety guarantee via `BatchMode=yes`**: Each measurement point runs a single read-only bash script that reads directly from `/proc`. The `BatchMode=yes` flag guarantees that the command is aborted immediately if the connection should, against expectations, try to ask for authentication.

### 2.2 Windows SSH Limitations & Fallback
Windows OpenSSH does not support UNIX domain sockets for ControlMaster. On Windows, sshs3 therefore uses a short-lived, non-interactive `ssh` connection in the background:
- Limited to key- and agent-based logins (password profiles without a password saved in the keychain are skipped to avoid prompts).
- The sampling interval on Windows is limited to at least every 10 seconds to avoid unnecessary process starts. Latency ("Ping") is measured as the TCP connect time to port 22.

### 2.3 Kubernetes Pods & Containers
Reads directly from the `metrics.k8s.io` API (equivalent to `kubectl top pod`):
- Measures CPU and memory per container relative to its configured **requests** and **limits**.
- Requires the cluster to have `metrics-server` installed. The polling interval is limited to at least 10 s because metrics-server in Kubernetes is updated every 15–60 seconds.

---

## 3. Detailed 15-Minute Diagnostics Modal

Click anywhere on the performance bar to open the in-depth diagnostics modal:

![Performance Diagnostics Modal](/img/docs/performance-detail.png)

---

## 4. Interpreting Metrics & Performance Diagnostics

As a system administrator or DevOps engineer, raw percentages are rarely enough. Here is how to interpret the specific metrics in sshs3:

### 4.1 CPU Breakdown: User+System vs. I/O Wait vs. Steal
The CPU donut chart divides the processor's time into four critical components:
1. **User + System (active computation)**:
   - The time the processor executes actual instructions (user programs or the kernel).
2. **I/O Wait (`iowait`) — a critical bottleneck metric**:
   - The time the processor is idle but **waiting for pending disk operations to complete**.
   - *Interpretation*: If CPU usage looks low (for example 25%) but `iowait` is at 60–70%, the server suffers from a **disk or I/O bottleneck** (for example an EBS volume on AWS that is too slow, a saturated database disk or heavy swap activity), not from a lack of CPU capacity.
3. **Steal (`steal`) — cloud neighbor warning ("Noisy Neighbors")**:
   - The time the virtual machine's processor was ready to run, but the hypervisor in the cloud (AWS EC2, GCP, Azure, Proxmox) took CPU cycles for other guests on the same physical hardware.
   - *Interpretation*: A `steal` above 5–10% means your cloud instance is oversubscribed or that neighboring machines on the same physical host are stealing CPU capacity.

---

### 4.2 Memory: Used vs. Buffers/Cache vs. Free
Many developers panic when they see 95% memory usage on Linux:
- **Page cache & buffers**: Linux never lets RAM sit empty and unused. Free memory is automatically allocated to cache read disk blocks. If a program suddenly needs memory, the page cache is released instantly.
- **sshs3 visualization**: The donut chart shows exactly how much is *actually locked by applications* (`Used`) versus what is *reclaimable cache* (`Cache/Buffers`) and entirely free (`Free`).

---

### 4.3 Load Average vs. Core Count (Core Normalization)
- Raw load numbers (for example `Load: 4.2`) are meaningless without knowing the number of CPU cores.
- On an **8-core server**, a load of 4.0 means the machine is **50%** loaded.
- On a **2-core server**, a load of 4.0 means the machine is overloaded to **200%** and processes are queuing.
- sshs3 always shows load in relation to the server's actual core count.

---

### 4.4 Kubernetes Pod Limits: Protection Against OOMKilled (Exit Code 137)
When a container approaches its memory limit (`limits.memory`), the Linux kernel OOM Killer steps in and terminates the container with `Exit Code 137`.
- In the performance bar and the history modal, container usage is visualized as colored gauges relative to **both request and limit**.
- This lets you spot memory leaks long before the container crashes and enters `CrashLoopBackOff`.
