# Audit fix tracker

Status of audit findings that have been triaged and acted on. Each entry was re-checked against the code
before fixing; the audit text alone was not trusted. Updated: 2026-10-27 22:45

| Finding | Verified | Severity (audit → assessed) | Status | Fix | Test |
|---|---|---|---|---|---|
| BUG-04-001 – profile pull deletes all local folders | yes | high → high | fixed (uncommitted) | `ProfileSyncService.pullFromRemote` keeps `local.folders` in `replaceAll` | `tests/main/ProfileSyncService.test.ts` |
| SEC-08-001 – `kubeConfigPath` controlled by renderer | yes | high → high | fixed (uncommitted) | `K8S_LOGIN` passes an explicit field list | `tests/main/k8sHandlers.login.test.ts` |
| SEC-03-001 – passphrase/password answers any askpass prompt | yes (host-key part already fixed in PTY; open in tunnels) | high → high | fixed (uncommitted) | `savedAskpassAnswer` in `askpassPrompt.ts`, used by `SSHPtyManager` and `SSHTunnelManager`; tunnels now fail closed on host-key prompts | `tests/main/askpassPrompt.test.ts` |
| SEC-04-001 – master passwords stored plaintext without keyring | yes | high → high | fixed (uncommitted) | `PROFILE_SYNC_LINK_SMARTCARD` refuses to store when `isEncryptedSecret` is false | `tests/main/ProfileSyncService.test.ts` |
| SEC-09-001 – option injection via remote filenames (`sed`/`tail`/`find`/`grep`) | yes (path flag injection real; the audit's `maxDepth` point was already guarded) | high → medium (needs newline filename or compromised renderer) | fixed (uncommitted) | `quotePathOperand` in `shellQuote.ts` anchors dash-leading paths with `./` (used for `sed`, `tail`, `find` root); `grep ... --`; `maxDepth`/`maxResults` must be integers | `tests/main/shellQuote.test.ts`, `tests/main/RemoteSearchService.test.ts` |
| BUG-04-004 – `SyncConfigStore` overwrites undecryptable target secrets with `''` | yes | high → high | fixed (uncommitted) | `persist()` re-reads the raw file and keeps still-encrypted values it cannot decrypt (same target id only); an unparsable file is copied to `.corrupt` first | `tests/main/SyncConfigStore.test.ts` |
| BUG-05-003 – Team Vault pull overwrites unpushed changes after restart | yes | medium → high (silent data loss) | fixed (uncommitted) | `lastSyncedRevision` persisted in `TeamVaultConfigStore` next to `lastKnownRemoteEntry`, restored by `hydratedState` (now also used by `pullFromRemote` and `hasUnpushedLocalChanges`); `resetRemoteState` clears the persisted copy | `tests/main/TeamVaultService.test.ts` (fails without the fix) |
| BUG-09-001 – DirSync to a new SFTP folder fails | yes | high → high | fixed (uncommitted) | `isNotFoundError` accepts `SftpError` with `statusCode` 2 | `tests/main/DirectorySyncService.test.ts` |
| BUG-06-004 – SFTP writes sent as one oversized packet | yes | high → high | fixed (uncommitted) | `SftpPacketProtocol.write` splits into 64 KiB `SSH_FXP_WRITE` packets (covers `put` and `SftpWriteStream`) | `tests/main/SftpPacketProtocol.test.ts` |
| SEC-07-001 – K8s pod symlinks/FIFOs not flagged | yes (script also run in a real `sh`) | high → medium | fixed (uncommitted) | `K8sPodStorageProvider.list`/`stat` emit `isLink`/`isReg` flags (appended as trailing columns, so older output still parses) → `isSymlink`/`isSpecial`; `TransferPipeline` and `DragOutService` already act on them | `tests/main/K8sPodStorageProvider.test.ts` |
| BUG-02-001 – DER length overflow loops forever | yes | high → low (input comes from the user's own card/cert) | fixed (uncommitted) | `readLength`/`readTlv` reject indefinite/over-long lengths and elements past the buffer; callers already catch | `tests/main/CertificateParser.test.ts` (fails without the fix) |
| BUG-09-002 – dotfile pool saves drop file tombstones / delete active master file | yes (steps 1-4; step 5 also real) | high → medium | fixed (uncommitted) | `savePool` carries over stored tombstones the incoming pool lacks (without mutating the caller's object), skips the `rm` when an active file shares the master path; `addFileToPool` is one queued read-modify-write | `tests/main/DotfilePoolStore.test.ts` (all three fail without the fix) |
| SEC-11-001 – SSH/S3 secrets from file manager tabs written to `session.json` | yes (renderer and main sanitizers both skipped tabs without a pane tree) | high → high (breaks the "never on disk" rule) | fixed (uncommitted) | `sanitizeTabConfigs` in `shared/sessionSanitize.ts` strips `password`/`passphrase`/`pin`/`secretAccessKey`/`sessionToken`/`proxy.password` from `initialSSHConfig`/`initialS3Config`; used by `sanitizeTabForSession` and by `SessionStore` (so it also cleans on load/save). The live in-memory tab is untouched | `tests/renderer/tabs.test.ts`, `tests/main/SessionStore.test.ts` (both fail without the fix) | <!-- pragma: allowlist secret -->
| SEC-12-002 – hovering a UNC path in terminal output triggers an SMB stat (NetNTLMv2 leak on Windows) | yes (logic; Windows behaviour not run) | high → medium-high (Windows only) | fixed (uncommitted) | `isUncPath` (`\\x`, `//x`, `\\?\`); `checkExistence` in `useTerminalPathHover` returns `unknown` without any lookup. Explicit clicks (open in editor) are unchanged | `tests/renderer/terminalPathPreview.test.ts` (pure function only; no hook-level test) |
| SEC-12-001 – control characters in file names / cwd break out of shell quoting | yes | high → medium (needs a hostile file name or cwd) | fixed (uncommitted) | `hasControlChars` in `lib/shellSafety.ts`; `isSafeEntryName`, `pasteLocal`, upload target folder/result path, unresolved names and `sendInitialCwd` refuse text containing C0/C1/DEL | `tests/renderer/useTerminalDropUpload.test.ts` (fails without the fix), `tests/renderer/shellSafety.test.ts` |

## Triaged, not fixed yet

| Finding | Verdict |
|---|---|
| SEC-05-001 – Team Vault `pkcs11LibPath` | real, medium; design decision (see `docs/team-vault-plan.md`) |
| SEC-04-003 / SEC-03-002 | by design (`pkcs11provider` allowed); needs master password; medium/low |
| SEC-09-002 | no trust boundary crossed; low |
| SEC-06-001 | overstated: connection fails, no TOFU bypass |

## Notes

- SEC-03-001 follow-up (`aefa027`): the saved passphrase only answers ssh's own `Enter passphrase for …` prompt. A later automated review asked for a stronger guarantee (ssh version check, or answering at most once). Not done: it rests on OpenSSH prefixing server keyboard-interactive prompts with `(user@host) `, which has not been tested against a real `ssh`.
- SEC-11-001: a `session.json` written by an earlier version may still hold secrets until the next save rewrites it (the app saves on startup once the session has loaded; `SessionStore` also sanitizes on read).
- Unverified, still open: SEC-05-002 (age PTY input), BUG-04-002/005 (ProfileSyncService races), BUG-03-002 (tunnel start skips `restoreSavedSecrets`).
