# Audit fix tracker

Status of audit findings that have been triaged and acted on. Each entry was re-checked against the code
before fixing; the audit text alone was not trusted. Updated: 2026-10-28 02:30

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
| SEC-12-002 – hovering a UNC path in terminal output triggers an SMB stat (NetNTLMv2 leak on Windows) | yes (logic; Windows behaviour not run) | high → medium-high (Windows only) | fixed (`eebcac3`, incomplete) + follow-up (uncommitted) | `eebcac3` only skipped the existence lookup, but the card still opened and then read the file / checked a certificate / offered drag-out, so the SMB access still happened. Follow-up: `isNetworkUncPath` (any two leading separators; WSL's `\\wsl.localhost\` and `\\wsl$\` shares stay allowed); the hover hook no longer opens the card for such paths, and `TerminalPathHoverCard` itself does no `fileRead`, certificate preview or drag-out for them. Explicit clicks (open in editor) are unchanged | `tests/renderer/terminalPathPreview.test.ts`, `tests/renderer/TerminalPathHoverCard.test.tsx` (fails without the card guard) |
| SEC-12-001 – control characters in file names / cwd break out of shell quoting | yes | high → medium (needs a hostile file name or cwd) | fixed (uncommitted) | `hasControlChars` in `lib/shellSafety.ts`; `isSafeEntryName`, `pasteLocal`, upload target folder/result path, unresolved names and `sendInitialCwd` refuse text containing C0/C1/DEL | `tests/renderer/useTerminalDropUpload.test.ts` (fails without the fix), `tests/renderer/shellSafety.test.ts` |
| BUG-04-005 – push/pull/compare/wipe not serialised | yes (no queue; started from debounced push, 60 s auto pull and manual calls) | high → medium | fixed (uncommitted) | `ProfileSyncService.runExclusive`: the four public methods queue behind each other (`…Now` implementations are private) | `tests/main/ProfileSyncService.test.ts` (fails without the fix; the fake provider is slowed so the operations overlap) |
| BUG-04-002 – `applySshNativePayload` bypasses the `~/.ssh/config` write queue; background regenerate races it | yes | high → medium | fixed (uncommitted) | the remote managed block is applied inside `enqueueSshConfigWrite`; `pullFromRemote` now applies it first and then `await`s `autoSyncLocalSshConfig()` (was a background `void` before it), so a pull no longer leaves this device falsely `ahead` | same test (the compare after the pull reports `in_sync`) |
| BUG-04-003 – fields cleared on another device survive a pull | yes | high → medium | fixed (uncommitted) | `mergeRecords` gets `onRemoteWins: replaceKeepingLocalOnly(spec, credentialsPulled)` for SSH and S3: the newer remote record replaces the local one; local-only fields (`privateKeyPath`, `pkcs11LibPath`, …) and, when the remote has no credentials half, the credential fields are kept from the local record | `tests/main/ProfileSyncService.test.ts` (clearing test fails without the fix; the credentials test is a regression guard) |
| BUG-02-002 – FIDO2 key manager lists / deletes the key's web passkeys, runs ykman on a dismissed PIN prompt, unhandled EPIPE | yes (all three parts; the EPIPE reproduced as an unhandled error in the test run) | high → high (a delete button on the user's Google/GitHub passkeys) | fixed (uncommitted) | `listFido2ResidentKeys` keeps only `ssh:` relying parties (OpenSSH only creates those); `deleteFido2ResidentKey` re-lists with the PIN and refuses anything not found or not `ssh:` (the id comes from the renderer); an empty PIN throws "PIN entry was cancelled" instead of running ykman; `runYkman` swallows the stdin `EPIPE` (the exit code still reports the failure) | `tests/main/Fido2KeyManager.test.ts` (3 fail without the fix), `tests/main/YkmanFido.test.ts` |
| BUG-07-001 – K8s write stream finishes before `cat` in the pod has | yes | high → medium | fixed (uncommitted) | `createWriteStream` overrides `_final` to wait for the exec status (same pattern as `S3StorageProvider`); a `Failure` status, a connection error or a close without status now fail the stream instead of being lost | `tests/main/K8sPodStorageProvider.test.ts` (3 tests, all fail without the fix) |
| BUG-03-002 – `SSH_TUNNEL_START` skips Team Vault reference and saved-secret resolution | yes (handler compared with `terminalHandlers`) | high → medium | fixed (uncommitted) | new `ipc/sshConfigResolve.ts` (`resolveSshConfigForConnect`: Team Vault reference, then `restoreSavedSecrets`), used by both the terminal and the tunnel handler instead of two copies. **Not done:** the agent-lifetime part of the finding (see note below) | `tests/main/k8sHandlers.tunnel.test.ts` (both tests fail without the fix); the terminal path stays covered by `tests/main/IpcBridge.test.ts` |

## Triaged, not fixed yet

| Finding | Verdict |
|---|---|
| SEC-05-001 – Team Vault `pkcs11LibPath` | real, medium; design decision (see `docs/team-vault-plan.md`) |
| SEC-04-003 / SEC-03-002 | by design (`pkcs11provider` allowed); needs master password; medium/low |
| SEC-09-002 | no trust boundary crossed; low |
| SEC-06-001 | overstated: connection fails, no TOFU bypass |
| BUG-07-002 – S3 upload never aborted | **refuted.** `pipeline()` destroys the sink with the error that ended it (`AbortError` or the source error), so the existing `'error'` handler calls `upload.abort()`; checked in Node 22 for both a failing source and an `AbortSignal`. The audit assumed `destroy()` without an error. A pipeline-level regression test now locks this in (`tests/main/S3StorageProvider.test.ts`); no code change |

## Notes

- SEC-03-001 follow-up (`aefa027`): the saved passphrase only answers ssh's own `Enter passphrase for …` prompt. A later automated review asked for a stronger guarantee (ssh version check, or answering at most once). Not done: it rests on OpenSSH prefixing server keyboard-interactive prompts with `(user@host) `, which has not been tested against a real `ssh`.
- SEC-11-001: a `session.json` written by an earlier version may still hold secrets until the next save rewrites it (the app saves on startup once the session has loaded; `SessionStore` also sanitizes on read).
- Unverified, still open: SEC-05-002 (age PTY input).
- BUG-03-002, agent lifetime: a per-session smartcard/FIDO2 agent is registered under the profile id (`smartcardSessionAgents.set(config.id, …)`) and only torn down when a terminal with that id exits (or the app quits). A second concurrent connection with the same profile id overwrites the entry, so the first agent process is no longer tracked; a tunnel never triggers the teardown at all. This affects two terminal tabs of one profile equally, so it is a design limit of the per-profile key rather than a tunnel bug. A fix needs per-connection ids (the UI matches tunnels to profiles through `connectionId: config.id`, so that id cannot simply change) or reference counting. Left open.
- BUG-04-003 changes a deliberate behaviour (the doc comment on `mergeRecords` described layering remote over local so local-only fields survive). Those fields are still kept; only fields the payload does carry now follow the remote. K8s profiles already worked this way (`replaceKeepingContext`).
- The queue in BUG-04-005 means a hung provider call now blocks later sync operations instead of running beside it.

## Code review of `1ff9c59..HEAD` (`/code-review high`)

No critical findings; nine remarks. Handled in the follow-up commit:

| Remark | Verdict | Change |
|---|---|---|
| `autoSyncLocalSshConfig` skipped when `applySshNativePayload` throws | valid | regeneration runs in a `finally`, because the profiles were already replaced |
| `quotePathOperand` only anchored a leading `-` | valid (`find` also reads `!`, `(`, `)`, `,`) | every relative operand gets `./`; absolute paths are left alone |
| `isUncPath` treated `//usr/bin` as a network share on Linux/macOS | valid, low | forward and mixed separator forms only count on Windows (`IS_WINDOWS`, overridable per call); the `\\server` form is blocked everywhere |
| `resetRemoteState` cleared the persisted copy with a fire-and-forget `void` | valid | now `async`, awaited by the handler, so a status refresh cannot read the old values |
| K8s write stream patched `PassThrough._final` and could wait forever | valid | a real `Writable` (`write`/`final`/`destroy`) that feeds the exec stdin; a 60 s timeout after the last byte |

Not changed:

- **Hung provider call blocks the sync queue** (`runExclusive` has no timeout). Known trade-off of BUG-04-005; needs a decision on the timeout.
- **SFTP `write()` awaits each 64 KiB packet** (one round trip each). Real; a bounded pipelining window would fix it but is larger and needs a real server to test.
- **"File tombstones are never created"** is wrong: the pool editor sets `deletedAt` on files in its draft (`DotfilePoolManagerModal.tsx:196`); the fix preserves the ones already stored.
- **A cleared secret is restored while its ciphertext is undecryptable** (`SyncConfigStore`): accepted edge case (locked keyring); the alternative is destroying the ciphertext. The claim that `.corrupt` is rewritten on every save is wrong, since the first save replaces the file with valid JSON.

## Code review of `8925d90..HEAD` (`faaa3e0`, `8539f87`)

No critical findings; six remarks. Handled in the follow-up commit:

| Remark | Verdict | Change |
|---|---|---|
| A relative search root printed as `./logs/…` by `find` no longer matched the root used for the displayed path | **valid, a regression from `faaa3e0`** (verified: `resolveRemotePath` returns a relative root unchanged) | new idempotent `anchorPath`; the search root is anchored once and that form is used both for `find` and for stripping the prefix from results |
| K8s write timeout / destroy did not close the exec websocket | valid | the session is closed (once) on timeout and on an abort or failure, and straight away if it was abandoned before the session had opened; not closed after a clean finish |
| `sshConfigResolve` doc claimed to cover every way of opening an SSH connection | partly valid (`gitHandlers` and `keyInstallHandlers` restore saved secrets but ignore a Team Vault reference) | comment corrected. The two flows are **not** switched over: whether a shared profile reaches them has not been checked |

Not changed:

- **60 s limit after the last byte** is my own choice; a slow PVC or NFS could need longer. Needs a decision.
- **`//` UNC detection depends on `navigator.userAgent`**: matches the host OS in Electron in practice; a main-side guard is the larger question already noted above.
- **A failing `ssh-native` payload leaves a partially applied pull unreported** and **`'error'` before a listener is attached**: both behave as before the changes under review.

