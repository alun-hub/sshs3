# Audit fix tracker

Status of audit findings that have been triaged and acted on. Each entry was re-checked against the code
before fixing; the audit text alone was not trusted. Updated: 2026-10-27 21:15

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

## Triaged, not fixed yet

| Finding | Verdict |
|---|---|
| SEC-07-001 – K8s symlinks followed | real, DoS/privacy; next release |
| SEC-05-001 – Team Vault `pkcs11LibPath` | real, medium; design decision (see `docs/team-vault-plan.md`) |
| BUG-02-001 – DER length overflow loop | real, low exploitability |
| SEC-04-003 / SEC-03-002 | by design (`pkcs11provider` allowed); needs master password; medium/low |
| SEC-09-002 | no trust boundary crossed; low |
| SEC-06-001 | overstated: connection fails, no TOFU bypass |
