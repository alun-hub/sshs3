# Networking, Proxies & SSH Tunnels

sshs3 provides powerful networking tools for navigating complex enterprise topologies, DMZs, bastion jump hosts, and private internal subnets.

---

## 1. ProxyJump (Bastion & Jump Host Chains)

When connecting to private instances that lack public IP addresses:
- **Profile Configuration**: Under *Network & Proxy*, set **ProxyJump** to your bastion server profile or hostname (e.g. `jumpbox.internal` or `bastion-admin`).
- **Multi-Hop Chaining**: Chain multiple jump hosts separated by commas (e.g. `jump01.corp.com,jump02.dmz.local`).
- OpenSSH forwards standard TCP streams automatically through the bastion chain with full end-to-end encryption between your workstation and the target host.

---

## 2. Standalone SSH Tunnels Manager

Unlike traditional SSH clients where port forwards terminate when a terminal tab is closed, sshs3 features an **independent background SSH Tunnels panel**.

### Forwarding Modes Supported:
1. **Local Port Forwarding (`-L`)**:
   - Forwards a local port on your workstation to a remote host/port via the SSH server.
   - Example: Forward local `127.0.0.1:5432` to remote database `postgres.internal:5432`.
2. **Remote Port Forwarding (`-R`)**:
   - Exposes a local service running on your workstation to the remote network.
   - Example: Expose your local development web server `localhost:3000` on the remote server's port `8080`.
3. **Dynamic Port Forwarding (SOCKS5 Proxy `-D`)**:
   - Spawns a local SOCKS5 proxy on your machine (e.g. `127.0.0.1:1080`).
   - Configure your browser or applications to route all internal web traffic through the remote server.

### Saved Tunnels & Independent Lifecycle
- Tunnels are defined once and saved in the SSH Tunnels menu.
- Start or stop any tunnel with a single click.
- Tunnels run in their own background processes—they continue running seamlessly even if you close all open terminal tabs.
- Easily delete obsolete saved tunnels directly from the menu.

---

## 3. HTTP & SOCKS5 Corporate Proxies

If your workstation connects to the internet via an outbound corporate proxy:
- Configure proxy settings per profile or globally.
- Supports both **HTTP/HTTPS CONNECT** proxies and **SOCKS5** proxies.
- Supports proxy authentication (usernames and passwords stored securely in system keychain).

---

## 4. X11 & GUI Forwarding

Run remote graphical Linux applications (such as `xclock`, `virt-manager`, `gvim`, or IDEs) and render them directly on your desktop:

### Linux Hosts
- Automatically forwards remote X11 traffic to your local `$DISPLAY` environment.

### Windows Workstations
- The official Windows Setup installer **bundles VcXsrv**, the high-performance Windows X11 server.
- sshs3 automatically configures the necessary display routing and launches the X server in the background when an X11-enabled profile connects.
