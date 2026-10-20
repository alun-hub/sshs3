## Windows vs. Linux: Differences, Limitations & Workarounds

sshs3 is one codebase, but the Windows build cannot do everything the Linux build does. Most gaps come from Microsoft's build of OpenSSH and from how Windows runs `ssh-agent`, not from sshs3 itself. Where the app can compensate, it does (and says so in the UI); this page lists what remains different.

## 1. At a Glance

| Area | Linux | Windows |
| :--- | :--- | :--- |
| FIDO2 **resident** (discoverable) keys | Supported (`ssh-add -K`, `ykman`) | **Not available**, use a key file instead |
| FIDO2 key file (`id_ed25519_sk`) in the terminal and SFTP | Supported | Supported (PIN + touch on every connection) |
| FIDO2 PIN caching / global agent / startup unlock | Supported | **Not applicable** |
| Smartcard (PKCS#11) PIN caching | Private `ssh-agent` per app/terminal | Shared Windows **ssh-agent service** |
| Needs an `ssh-agent` service set up first | No, the app spawns its own | **Yes**, the "OpenSSH Authentication Agent" service |
| `libykcs11` (Yubico) through the agent | Works | Needs one extra setup step (system `PATH`) |
| `p11-kit` | Supported (recommended) | Not available |
| Certificate details in the cached-cards popover | Always | Depends on the build; OpenSC is needed for the fallback |
| Unlocked cards usable from any terminal (`sshs3-agent` block in `~/.ssh/config`) | Yes | No |

---

## 2. FIDO2 / Security Keys on Windows

- **Resident (discoverable) credentials do not work on Windows.** They can only be read back from the device with `ssh-add -K`, `ssh-keygen -K` or `ykman`. On Windows `ssh-add -K` fails (`Provider "internal" returned failure -1` / `device not found`, even as Administrator) and `ykman fido credentials list` refuses to run without Administrator rights. The profile form therefore disables the *resident* option, the key generator only offers a key **file**, the automatic scan never runs, and the FIDO2 step of **Unlock at startup** is skipped.
- **Use a key file instead.** In the profile, leave *resident* unticked and use **Generate a new key on this security key** (or pick an existing `id_ed25519_sk` / `id_ecdsa_sk`). Windows signs through its own WebAuthn support, which needs no Administrator rights. Add the new public key to the server's `authorized_keys`.
  - If generation fails with `A resident key scoped to 'ssh:…' already exists … Overwrite key in token (y/n)?`, the device already holds a resident credential with that name from an earlier attempt. Untick *resident* or use a different output file name.
- **A touch is required on every connection.** A key created with *Require PIN + touch* needs a physical touch for every signature, so there is nothing to cache on Windows.
- **SFTP works with FIDO2 key files**, because the file manager uses the same OpenSSH client as the terminal: you get the usual PIN dialog and touch banner.
- **Beware repeated PIN attempts.** A FIDO2 key counts failed or rapid PIN verifications and temporarily blocks PIN entry until it is unplugged and reconnected.

---

## 3. Smartcards / PKCS#11 on Windows

### A shared system agent instead of a private one
On Linux every PIN-caching mode spawns its own private `ssh-agent`. Windows' `ssh-agent.exe` only runs as the single system service (pipe `\\.\pipe\openssh-ssh-agent`) and refuses a second instance, so **all** modes, including *Always Prompt*, load the card into that shared service (`ssh-add -s`) and evict just that card afterwards (`ssh-add -e`). Consequences:
- Any other program that talks to the Windows OpenSSH agent can use the card while it is loaded (Global mode: until you quit the app or use **Lock All Now**).
- The top-bar card popover lists *everything* in that agent, including keys you added yourself with `ssh-add`.
- Restarting the service clears every key in it.

This is required, not optional: Win32-OpenSSH's `ssh-pkcs11-helper` does not reliably route a smartcard PIN prompt through the askpass dialog, so a direct login falls through to a Windows account password prompt.

### The "OpenSSH Authentication Agent" service must be running
The service is disabled by default, and the *OpenSSH Client* optional feature must be installed. The **installer** asks for administrator approval (UAC) near the end of setup and sets the service to *Automatic* and starts it. It does **not** do this for silent installs and auto-updates (to avoid a UAC prompt on every update), for the **portable** build, or if you decline the prompt. Then run once, as Administrator:

```powershell
Set-Service ssh-agent -StartupType Automatic; Start-Service ssh-agent
```

Without it you will see *"Startup unlock failed … Windows OpenSSH Authentication Agent service is not running"*.

### Pick the right PKCS#11 driver
Windows detects Net iD, OpenSC and Yubico's `libykcs11`; there is no `p11-kit`. **OpenSC (`opensc-pkcs11.dll`) is listed before `libykcs11` and is the most reliable choice**, including for a YubiKey's PIV applet. The default driver you choose in the *Smartcard* settings is used by startup unlock, by Remote Profile Sync linking and as the fallback for profiles without a driver of their own; a profile's own driver wins.

### `libykcs11.dll` needs its folder on the system `PATH`
`libykcs11.dll` depends on DLLs (`libcrypto-3-x64.dll`, `libykpiv.dll`, `zlib1.dll`) that sit next to it, and the agent service only searches the *machine* `PATH`. Without that, `ssh-add -s` fails with just `agent refused operation`, before any PIN reaches the card, so a "wrong PIN" retry message would be misleading (your PIN retry counter is untouched; check with `ykman piv info`).

When the chosen default driver is affected, Settings shows **Fix Windows ssh-agent (administrator)**. It adds the driver's folder to the **system-wide** `PATH` and restarts the agent, after a UAC prompt. The change is visible to every program (the DLLs have generic names) and clears keys loaded in the agent, which is why it is an explicit button and not something the installer does. Manual equivalent, as Administrator:

```powershell
$p = 'C:\Program Files\Yubico\Yubico PIV Tool\bin'
[Environment]::SetEnvironmentVariable('Path', [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + $p, 'Machine')
Restart-Service ssh-agent
```

### Certificate details in the cached-cards popover
Subject, UPN and validity are read through the native `pkcs11js` addon, which needs a compiler toolchain (Python + Visual C++ build tools) to build and may be missing in a given Windows build. When it is not there, sshs3 falls back to OpenSC's `pkcs11-tool.exe`. With neither, the identity shows its key type but "No certificate details found on the card".

### Two drivers for one card do not share a cache
The global cache is keyed by library path, so the same physical card loaded through `opensc-pkcs11.dll` and through `libykcs11.dll` counts as two entries and asks for the PIN twice. Keep profiles and the default driver on the same library.

### SFTP with a smartcard
The agent exposes the PIV key as a normal RSA/ECDSA key, so SFTP is expected to work; like every PKCS#11 operation it needs the PIN once per the caching mode.

---

## 4. `~/.ssh/config` on Windows

Windows paths contain spaces (`C:\Program Files\…`), which OpenSSH would split into separate arguments and then reject the whole `~/.ssh/config`. When sshs3 writes the managed block it quotes `PKCS11Provider` / `IdentityFile` / `CertificateFile` values that contain spaces and uses forward slashes. Library and key paths are machine-specific, so treat the managed block as per-machine: a block generated on Windows is not meaningful on a Linux machine and vice versa.

---

## 5. Other Windows Notes

- **X11**: a bundled VcXsrv is installed and managed for you, see [Networking & X11](/docs/networking-tunnels/).
- **Performance bar over SSH**: Windows OpenSSH has no `ControlMaster`, so every sample is a short-lived non-interactive connection (minimum interval 10 s). It only works for sessions that need no interaction per login: not FIDO2, not a smartcard without a cached agent, and not a password that is not saved. See [Performance Bar](/docs/performance-bar/).
- **Unsigned builds**: Windows builds are not code-signed yet; SmartScreen may warn, and the app does not update itself on Windows. See [Installation & Updates](/docs/getting-started/).

---

## 6. Troubleshooting

| Symptom / Error Message | Probable Root Cause | Corrective Action |
| :--- | :--- | :--- |
| `Startup unlock failed … Windows OpenSSH Authentication Agent service is not running` | Service disabled (portable build, silent install, declined UAC) | Run the `Set-Service ssh-agent …` command above as Administrator. |
| `agent refused operation` with `libykcs11` | Driver DLLs not on the machine `PATH` | Use **Fix Windows ssh-agent (administrator)** in Settings, or switch to OpenSC. |
| PIN asked twice for the same card | Same card loaded via two different drivers | Use one driver for the default and all profiles. |
| `Provider "internal" returned failure -1` | Resident FIDO2 key on Windows | Use a key file instead of a resident credential. |
| `line N: keyword pkcs11provider extra arguments at end of line` | Unquoted path with spaces from an older block | Let sshs3 regenerate the managed block; paths are now quoted. |
