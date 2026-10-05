# Networking, Proxies & SSH Tunnels (Complete Networking Guide)

**sshs3** provides professional networking tools for navigating complex corporate networks, DMZ zones, bastions and isolated private subnets.

---

## 1. ProxyJump (Bastion & Jump Host Chains)

When you connect to internal servers in a private network (without public IP addresses), you connect through an intermediate bastion (jump host):

```
┌─────────────────┐       ┌───────────────────────┐       ┌────────────────────────┐
│ Your Workstation│ ────► │ Bastion (jumpbox.corp)│ ────► │ Internal Server (web-01)│
└─────────────────┘       └───────────────────────┘       └────────────────────────┘
         └────────────────── E2E Encrypted SSH Tunnel ───────────────────┘
```

### Configuration in the Profile:
- **Profile choice (`proxyJumpProfileId`)**: Select an existing saved SSH profile from the drop-down as the jump host. sshs3 automatically reuses the jump host's keys, passwords and ports.
- **Manual jump string (`proxyJump`)**: Enter a custom ProxyJump string (for example `jumpuser@bastion.example.com:22`).
- **Multi-hop**: Separate several jump hosts with commas (`bastion1.corp.com,bastion2.dmz.internal`).
- **Security**: Traffic is end-to-end encrypted between your computer and the final destination. The administrator of the bastion cannot eavesdrop on or decrypt the session.

---

## 2. Standalone Background Tunnels (SSH Tunnels Panel)

In traditional SSH clients, port forwarding ends the second you close the terminal window. In sshs3, **SSH Tunnels is a standalone background service** with a lifecycle of its own:

![Standalone SSH tunnels](/img/ssh-tunnels.png)

> [!IMPORTANT]
> **Independent lifecycle**: A tunnel started from the SSH Tunnels panel keeps running in the background even if you close all open terminal tabs or work in the file manager.

### 2.1 Supported Tunnel Modes

#### A. Local Port Forwarding (`-L`)
- **Purpose**: Makes a remote service (for example an internal PostgreSQL database or an internal web interface) available on a local port on your own computer.
- **Example**:
  - `Local Port`: `5432`
  - `Remote Host`: `postgres.internal.corp`
  - `Remote Port`: `5432`
- **Result**: You can connect your local database tool (DBeaver, psql) directly to `localhost:5432`.

#### B. Remote Port Forwarding (`-R`)
- **Purpose**: Exposes a local web server or service running on your computer to the remote network.
- **Example**: Expose your local development server on `localhost:3000` as port `8080` on the remote server so colleagues can test your API.

#### C. Dynamic Port Forwarding (SOCKS5 Proxy `-D`)
- **Purpose**: Starts a local SOCKS5 proxy on your machine (for example `127.0.0.1:1080`).
- **How it is used**: Configure your browser (Firefox, Chrome) or tools (`curl --socks5 127.0.0.1:1080`) to send traffic through the tunnel. All web traffic is then routed encrypted through the SSH server and out onto its local network.

### 2.2 Saving & Managing Tunnels
- Click the **SSH Tunnels** button in the top bar to open the tunnel panel.
- Create and name reusable tunnel configurations (for example *"Prod DB Tunnel"*).
- Start and stop with one click. The status indicator shows real-time traffic and the active process.

---

## 3. X11 & Graphical Forwarding (GUI Forwarding)

Run graphical Linux programs (such as `virt-manager`, `xclock`, `gvim`, or proprietary diagnostic tools) on the remote server and show the windows seamlessly on your desktop:

- **Linux**: Uses your local `$DISPLAY` (works with both X11 and through XWayland).
- **Windows**: The official installer (`sshs3-Setup-*.exe`) **includes the proven VcXsrv X server**. sshs3 starts and configures the display routing automatically when you connect to a profile with X11 enabled.
