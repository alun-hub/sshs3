# OpenSSH SFTP – Fullständig Teknisk Specifikation & Implementationsplan
> **Status: genomförd (fas 1–5).** Avvikelser: `SFTPStorageProvider` använder `OpenSshSftpClientAdapter` (ssh2-sftp-client-lik fasad över `SftpPacketProtocol`) i stället för direkt protokollinjektion; värdnyckelfrågor från OpenSSH (askpass) routas till appens TOFU-dialog via `hostVerifier.hostKeyPrompt` och avvisas (fail closed) om ingen hanterare finns; `FileTailService`/`RemoteSearchService` använder `createExecStream`/`exec`.
> **Mål:** Ersätta npm `ssh2` och `ssh2-sftp-client` med en inbyggd OpenSSH-baserad SFTP-motor (`ssh -s sftp`) för att ge fullt stöd för FIDO2, PIV, `~/.ssh/config` och multiplexing.
> **Målgrupp för detta dokument:** Utvecklare och autonoma LLM-agenter. Dokumentet är designat för att vara **självförklarande och direkt exekverbart** utan gissningar.

---

## Innehållsförteckning
1. [Översikt & Arkitektur](#1-översikt--arkitektur)
2. [Filkarta (Nya, Modifierade & Borttagna filer)](#2-filkarta)
3. [SFTP v3 Wire Protocol Specifikation](#3-sftp-v3-wire-protocol-specifikation)
4. [Klass- & Moduldesign (Med Kodskelett & Gränssnitt)](#4-klass---moduldesign)
   - [4.1 SftpConstants.ts](#41-sftpconstantsts)
   - [4.2 SftpPacketProtocol.ts](#42-sftppacketprotocolts)
   - [4.3 SftpStreams.ts (Readable & Writable)](#43-sftpstreamsts)
   - [4.4 OpenSshSftpProcess.ts](#44-opensshsftpprocessts)
   - [4.5 SFTPStorageProvider.ts (Refaktorisering)](#45-sftpstorageproviderts)
5. [Plattformshantering (Linux vs Windows)](#5-plattformshantering)
6. [FIDO2 & PIV (Smartcard) Flöden](#6-fido2--piv-flöden)
7. [Anpassning av Befintliga Tjänster (Search, Tail, IpcBridge)](#7-anpassning-av-befintliga-tjänster)
8. [Teststrategi & Mockning (SFTPStorageProvider.test.ts)](#8-teststrategi--mockning)
9. [Fasindelad Exekveringsordning](#9-fasindelad-exekveringsordning)

---

## 1. Översikt & Arkitektur

### Vald modell: Spår A – OpenSSH Subsystem Wire Engine
```
+-------------------------------------------------------------------------------+
|                             sshs3 Main Process                                |
|                                                                               |
|  +-------------------------------------------------------------------------+  |
|  |                           SFTPStorageProvider                           |  |
|  |  (IStorageProvider: list, stat, createReadStream, createWriteStream...)  |  |
|  +------------------------------------+------------------------------------+  |
|                                       |                                       |
|                                       v                                       |
|  +-------------------------------------------------------------------------+  |
|  |                           OpenSshSftpProcess                            |  |
|  |  - Bygger SSH-argument via SmartcardDetector.buildSSHArguments           |  |
|  |  - Konfigurerar AskpassServer (SSH_ASKPASS) för PIN/lösenord            |  |
|  |  - Spawna: `ssh -o BatchMode=no [args...] -s sftp <host>`               |  |
|  |  - Lyssnar på stderr för touch-presence ("Confirm user presence...")     |  |
|  +--------------------+------------------------------------+---------------+  |
|                       | (child.stdin)                      | (child.stdout)   |
|                       v                                    |                  |
|  +---------------------------------------------------------+---------------+  |
|  |                           SftpPacketProtocol                            |  |
|  |  - Binär avkodning och serialisering av SFTP v3 (RFC draft-ietf-secsh)  |  |
|  |  - Hanterar requestId-routing och pipelined asynchronous requests       |  |
|  |  - Driver SftpReadStream och SftpWriteStream med äkta Node backpressure |  |
|  +-------------------------------------------------------------------------+  |
+---------------------------------------|---------------------------------------+
                                        | OS stdio pipes
                                        v
+-------------------------------------------------------------------------------+
|                     OpenSSH Barnprocess (`ssh` / `ssh.exe`)                   |
|                                                                               |
|  - Sköter 100% av TCP, TLS/SSH-krypto, nyckelutbyte, ProxyJump, KnownHosts     |
|  - FIDO2 via libfido2 (Linux) eller webauthn.dll (Windows)                    |
|  - PIV Smartcards via -I <pkcs11LibPath>                                      |
|  - Multiplexing över ControlPath (Linux/macOS)                                |
+---------------------------------------+---------------------------------------+
                                        | SSH Subsystem Channel "sftp"
                                        v
                            Remote Server (`sshd`)
```

---

## 2. Filkarta

### Nya filer:
- `src/main/storage/sftp/SftpConstants.ts` – SFTP v3 paket-opkoder, statuskoder, attributflaggor och open-flaggor.
- `src/main/storage/sftp/SftpPacketProtocol.ts` – Binär serializer/deserializer, request-pipeline och protokollmotor över en duplex stream.
- `src/main/storage/sftp/SftpStreams.ts` – `SftpReadStream` (ärver `Readable`) och `SftpWriteStream` (ärver `Writable`).
- `src/main/storage/sftp/OpenSshSftpProcess.ts` – Spawna och hantera OpenSSH-processen, Askpass-miljö, stderr-presence och lifecycle.
- `tests/main/SftpPacketProtocol.test.ts` – Enhetstester för paketkodning/-avkodning via in-memory mock-streams.
- `tests/main/OpenSshSftpProcess.test.ts` – Enhetstester för processargument, askpass-koppling och presence-detektering.

### Modifierade filer:
- `src/main/storage/SFTPStorageProvider.ts` – Ersätt `ssh2-sftp-client` och `ssh2` mot `OpenSshSftpProcess` / `SftpPacketProtocol`.
- `src/main/editor/FileTailService.ts` – Ersätt `(provider as any).client?.client.exec` med `provider.exec()` eller `provider.createExecStream()`.
- `src/main/search/RemoteSearchService.ts` – Ersätt `(provider as any).client?.client.exec` med `provider.exec()` eller `provider.createExecStream()`.
- `src/main/IpcBridge.ts` – Ta bort felblockeringen för FIDO2 SFTP i `prepareFido2SftpConfig` och låt OpenSSH sköta autentiseringen via `buildSSHArguments`.
- `src/shared/types/storage.ts` – Uppdatera kommentarer och typer som refererade till att SFTP saknar FIDO2-stöd.
- `package.json` – Ta bort `ssh2` och `ssh2-sftp-client` ur dependencies.
- `vite.config.ts` – Ta bort `ssh2` och `ssh2-sftp-client` ur externals/rollupOptions.
- `tests/main/SFTPStorageProvider.test.ts` – Uppdatera mockningen från `ssh2-sftp-client` till den nya klienten.

---

## 3. SFTP v3 Wire Protocol Specifikation

SFTP v3 skickar längd-prefixade binära meddelanden över transportströmmen:
```
+-------------------+-------------------+--------------------+------------------------+
| Length (4B BE)    | Type (1B uint8)   | RequestId (4B BE)  | Payload (variabel)    |
+-------------------+-------------------+--------------------+------------------------+
```
*(Undantag: `SSH_FXP_INIT` och `SSH_FXP_VERSION` har inget RequestId: `Length (4B) | Type (1B) | Version (4B)`).*

### Opkoder (Packet Types):
```typescript
export const FXP = {
  INIT: 1,
  VERSION: 2,
  OPEN: 3,
  CLOSE: 4,
  READ: 5,
  WRITE: 6,
  LSTAT: 7,
  FSTAT: 8,
  SETSTAT: 9,
  FSETSTAT: 10,
  OPENDIR: 11,
  READDIR: 12,
  REMOVE: 13,
  MKDIR: 14,
  RMDIR: 15,
  REALPATH: 16,
  STAT: 17,
  RENAME: 18,
  READLINK: 19,
  SYMLINK: 20,
  STATUS: 101,
  HANDLE: 102,
  DATA: 103,
  NAME: 104,
  ATTRS: 105,
  EXTENDED: 200,
  EXTENDED_REPLY: 201,
} as const;
```

### Open Flags (`pflags` i `SSH_FXP_OPEN`):
```typescript
export const FXF = {
  READ: 0x00000001,
  WRITE: 0x00000002,
  APPEND: 0x00000004,
  CREAT: 0x00000008,
  TRUNC: 0x00000010,
  EXCL: 0x00000020,
} as const;
```

### Attribute Flags & Layout (`ATTRS`):
```typescript
export const ATTR = {
  SIZE: 0x00000001,
  UIDGID: 0x00000002,
  PERMISSIONS: 0x00000004,
  ACMODTIME: 0x00000008,
} as const;
```
Attributserialisering:
- `flags` (uint32be)
- Om `flags & ATTR.SIZE`: `size` (uint64be / BigInt)
- Om `flags & ATTR.UIDGID`: `uid` (uint32be), `gid` (uint32be)
- Om `flags & ATTR.PERMISSIONS`: `permissions` (uint32be)
- Om `flags & ATTR.ACMODTIME`: `atime` (uint32be), `mtime` (uint32be)

### Statuskoder (`SSH_FXP_STATUS`):
```typescript
export const FX_STATUS = {
  OK: 0,
  EOF: 1,
  NO_SUCH_FILE: 2,
  PERMISSION_DENIED: 3,
  FAILURE: 4,
  BAD_MESSAGE: 5,
  NO_CONNECTION: 6,
  CONNECTION_LOST: 7,
  OP_UNSUPPORTED: 8,
} as const;
```

### OpenSSH Extension: `posix-rename@openssh.com`
Skickas som `SSH_FXP_EXTENDED`:
- `requestId` (uint32be)
- `extension_name`: `"posix-rename@openssh.com"` (string: uint32be len + utf8)
- `oldpath`: string (uint32be len + utf8)
- `newpath`: string (uint32be len + utf8)
Svar: `SSH_FXP_STATUS`.

---

## 4. Klass- & Moduldesign

### 4.1 SftpConstants.ts
Plats: `src/main/storage/sftp/SftpConstants.ts`
Innehåller definitioner av `FXP`, `FXF`, `ATTR`, `FX_STATUS`, samt hjälptyper för SFTP-attribut (`SftpFileStats`, `SftpNameEntry`).

```typescript
export interface SftpFileStats {
  size: number;
  uid?: number;
  gid?: number;
  mode?: number;
  atime?: number;
  mtime?: number;
  isDirectory: boolean;
  isSymlink: boolean;
}

export interface SftpNameEntry {
  filename: string;
  longname: string;
  attrs: SftpFileStats;
}
```

---

### 4.2 SftpPacketProtocol.ts
Plats: `src/main/storage/sftp/SftpPacketProtocol.ts`
Kärnprotokollmotor som hanterar en `Readable` och `Writable` ström (t.ex. `child.stdout` och `child.stdin`).

```typescript
export class SftpPacketProtocol extends EventEmitter {
  private nextRequestId = 1;
  private pendingRequests = new Map<number, {
    resolve: (res: any) => void;
    reject: (err: Error) => void;
    type: number;
  }>();
  private incomingBuffer = Buffer.alloc(0);

  constructor(private readable: NodeJS.ReadableStream, private writable: NodeJS.WritableStream) {
    super();
    this.readable.on('data', (chunk: Buffer) => this.onData(chunk));
    this.readable.on('error', (err) => this.onError(err));
    this.readable.on('close', () => this.onClose());
  }

  public async init(): Promise<number>;
  public async open(path: string, pflags: number, attrs?: Partial<SftpFileStats>): Promise<Buffer>;
  public async close(handle: Buffer): Promise<void>;
  public async read(handle: Buffer, offset: number, length: number): Promise<Buffer | null>; // null = EOF
  public async write(handle: Buffer, offset: number, data: Buffer): Promise<void>;
  public async stat(path: string): Promise<SftpFileStats>;
  public async lstat(path: string): Promise<SftpFileStats>;
  public async fstat(handle: Buffer): Promise<SftpFileStats>;
  public async setstat(path: string, attrs: { mode?: number; mtime?: number; atime?: number }): Promise<void>;
  public async opendir(path: string): Promise<Buffer>;
  public async readdir(handle: Buffer): Promise<SftpNameEntry[] | null>; // null = EOF
  public async mkdir(path: string, attrs?: Partial<SftpFileStats>): Promise<void>;
  public async rmdir(path: string): Promise<void>;
  public async remove(path: string): Promise<void>;
  public async rename(oldPath: string, newPath: string): Promise<void>;
  public async posixRename(oldPath: string, newPath: string): Promise<void>;
  public async realpath(path: string): Promise<string>;
}
```

**Buffring & Packet Parsing:**
- Samla inkommande chunks i `this.incomingBuffer`.
- Loopa: Om `incomingBuffer.length >= 4`, läs `packetLength = incomingBuffer.readUInt32BE(0)`.
- Om `incomingBuffer.length >= 4 + packetLength`: Klipp ut paketet `const packet = incomingBuffer.subarray(4, 4 + packetLength)`, uppdatera `this.incomingBuffer = incomingBuffer.subarray(4 + packetLength)`.
- Parsa `packetType = packet.readUInt8(0)`.
- Om `packetType === FXP.VERSION`: Slutför `init()`.
- Annars läs `requestId = packet.readUInt32BE(1)`. Matcha mot `this.pendingRequests.get(requestId)` och anropa dess `resolve`/`reject`.

---

### 4.3 SftpStreams.ts
Plats: `src/main/storage/sftp/SftpStreams.ts`

#### `SftpReadStream` (ärver `Readable`)
- Tar `protocol: SftpPacketProtocol`, `path: string`, `options?: { start?: number; end?: number; chunkSize?: number }`.
- Default `chunkSize = 64 * 1024` (64 KB).
- I `_construct(cb)`: Anropar `protocol.open(path, FXF.READ)`, sparar `handle`.
- I `_read(size)`: Läser `min(chunkSize, remainingBytes)` från aktuell `offset` via `protocol.read()`.
  - Vid data: `this.push(data)`, uppdatera `offset += data.length`.
  - Vid EOF (`null` eller `offset >= end`): `this.push(null)`.
- I `_destroy(err, cb)`: Anropar `protocol.close(handle)` och anropar därefter `cb(err)`.

#### `SftpWriteStream` (ärver `Writable`)
- Tar `protocol: SftpPacketProtocol`, `path: string`, `options?: { mode?: number; flags?: string }`.
- I `_construct(cb)`: Anropar `protocol.open(path, FXF.WRITE | FXF.CREAT | FXF.TRUNC, { mode })`.
- I `_write(chunk, encoding, cb)`: Skriver data via `protocol.write(handle, offset, chunk)`, ökar `offset += chunk.length`, anropar `cb()`.
- I `_final(cb)`: Anropar `cb()`.
- I `_destroy(err, cb)`: Anropar `protocol.close(handle)` och därefter `cb(err)`.

---

### 4.4 OpenSshSftpProcess.ts
Plats: `src/main/storage/sftp/OpenSshSftpProcess.ts`

Hanterar livscykeln för `ssh`-barnprocessen.

```typescript
export interface OpenSshProcessOptions {
  config: SFTPConfig;
  controlPath?: string;
  onPresence?: (prompt: string) => void;
  onPresenceCleared?: () => void;
  pinPromptHandler?: (prompt: string) => Promise<string> | string;
}

export class OpenSshSftpProcess {
  private child?: ChildProcess;
  private askpassServer?: AskpassServer;
  private protocol?: SftpPacketProtocol;
  private isClosed = false;

  public async start(options: OpenSshProcessOptions): Promise<SftpPacketProtocol> {
    // 1. Starta AskpassServer om lösenord, passphrase, smartcard eller fido2 används
    // 2. Generera argument: SmartcardDetector.buildSSHArguments(config, controlPath)
    // 3. Lägg till subsystem-flaggor: args.push('-s', 'sftp')
    // 4. Lägg till args.push('-o', 'BatchMode=no')
    // 5. Spawna child_process.spawn(sshBinary, args, { stdio: ['pipe', 'pipe', 'pipe'], env })
    // 6. Övervaka stderr:
    //    - /confirm user presence/i -> emit onPresence
    //    - Felmeddelanden sparas i buffer för diagnos vid exit
    // 7. Skapa protocol = new SftpPacketProtocol(child.stdout, child.stdin)
    // 8. await protocol.init()
    // 9. Returnera protocol
  }

  public async exec(cmd: string): Promise<{ stdout: Buffer; stderr: string }>;
  public createExecStream(cmd: string): NodeJS.ReadableStream;
  public async close(): Promise<void>;
}
```

---

### 4.5 SFTPStorageProvider.ts (Refaktorisering)
Plats: `src/main/storage/SFTPStorageProvider.ts`

- **Ta bort:**
  - `import SftpClient from 'ssh2-sftp-client';`
  - `import { Client as SSH2Client } from 'ssh2';`
  - `loadSmartcardIntoAgent()` och alla interna efemära `ssh-agent`-funktioner.
  - Felblockeringen för FIDO2:
    ```typescript
    // TA BORT:
    if (this.config.authType === 'fido2') {
      throw new Error("SFTP can't log in with a FIDO2 security key...");
    }
    ```
- **Injicera:**
  - Byt `private client: SftpClient;` mot `private sftpProcess?: OpenSshSftpProcess;` och `private protocol?: SftpPacketProtocol;`.
  - Stöd constructor-injektion av `mockProtocol?: SftpPacketProtocol` för enhetstester:
    ```typescript
    constructor(
      config: SFTPConfig,
      protocolClient?: SftpPacketProtocol,
      hostVerifier?: SshHostVerifierFn,
      pinPromptHandler?: (prompt: string) => Promise<string> | string
    )
    ```
- **Implementera `IStorageProvider`-metoderna via `this.protocol`:**
  - `list(remotePath)`: `opendir` + `readdir` tills EOF + `close`. Mappar till `FileEntry[]`.
  - `stat(remotePath)`: `protocol.stat(remotePath)`.
  - `createFolder(remotePath)`: `protocol.mkdir(remotePath)`.
  - `delete(remotePath, isDir)`: `protocol.rmdir(path)` eller `protocol.remove(path)`.
  - `rename(oldPath, newPath)`: Testa först `protocol.posixRename(old, new)`. Vid fel (t.ex. server utan extension): anropa `protocol.rename(old, new)`.
  - `createReadStream(path, start, end)`: Returnera `new SftpReadStream(protocol, path, { start, end })`.
  - `createWriteStream(path, options)`: Returnera `new SftpWriteStream(protocol, path, options)`.
  - `chmod(path, mode)`: `protocol.setstat(path, { mode: numericMode })`.
  - `setModifiedTime(path, mtimeMs)`: `protocol.setstat(path, { mtime: Math.floor(mtimeMs / 1000) })`.

---

## 5. Plattformshantering (Linux vs Windows)

1. **Binärsökväg:**
   ```typescript
   const sshBinary = process.platform === 'win32'
     ? (fs.existsSync('C:\\Windows\\System32\\OpenSSH\\ssh.exe') ? 'C:\\Windows\\System32\\OpenSSH\\ssh.exe' : 'ssh.exe')
     : 'ssh';
   ```
2. **Multiplexing (`ControlMaster` / `ControlPath`):**
   - Endast aktivt på non-Windows:
     ```typescript
     const controlPath = process.platform !== 'win32'
       ? path.join(os.tmpdir(), `s3m-sftp-${crypto.randomUUID().slice(0, 8)}.sock`)
       : undefined;
     ```
   - Om det finns en aktiv terminalflik mot samma host, kan SFTP använda terminalens `controlPath` för omedelbar anslutning utan ny handskakning!
3. **Askpass på Windows vs POSIX:**
   - Redan implementerat i `AskpassServer`: Unix domain socket på Linux/macOS, TCP loopback (127.0.0.1) med autentiseringstoken på Windows.

---

## 6. FIDO2 & PIV (Smartcard) Flöden

### FIDO2-användarflöde:
1. `OpenSshSftpProcess` startar med `SSH_ASKPASS` satt till `AskpassServer`.
2. Vid anslutning instruerar OpenSSH användaren att vidröra nyckeln.
3. `OpenSshSftpProcess` fångar `Confirm user presence` på `stderr` och skickar eventet vidare till appens UI -> touch-bannern visas.
4. Om nyckeln kräver User Verification PIN frågar OpenSSH via `SSH_ASKPASS` -> `AskpassServer` visar `SmartcardPinModal`.
5. Anslutningen etableras.
6. På Linux hålls anslutningen vid liv via ControlPath; användaren behöver aldrig röra nyckeln igen under sessionen.

### PIV-användarflöde:
1. OpenSSH körs med `-I <pkcs11LibPath>`.
2. OpenSSH begär smartcard-PIN via `SSH_ASKPASS`.
3. `AskpassServer` fångar prompten och visar PIN-modalen.
4. Ingen privat `ssh-agent` eller `ssh-add -s` behövs!

---

## 7. Anpassning av Befintliga Tjänster

### `RemoteSearchService.ts` & `FileTailService.ts`:
Idag gör båda tjänsterna:
```typescript
// Gammal kod:
const rawSshClient = (provider as any).client?.client;
rawSshClient.exec(cmd, ...);
```
**Ny lösning:**
Lägg till en publik metod på `SFTPStorageProvider`:
```typescript
public async exec(cmd: string): Promise<{ stdout: Buffer; stderr: string }> {
  await this.ensureConnected();
  return this.sftpProcess!.exec(cmd);
}

public createExecStream(cmd: string): NodeJS.ReadableStream {
  return this.sftpProcess!.createExecStream(cmd);
}
```
`FileTailService` och `RemoteSearchService` anropar nu `provider.createExecStream(cmd)` och `provider.exec(cmd)` direkt. Detta är typat, rent och säkert.

### `IpcBridge.ts`:
- Ta bort restriktionerna i `prepareFido2SftpConfig` (rad 1555). Låt SFTP-konfigurationen behålla `authType: 'fido2'` så att `buildSSHArguments` genererar rätt OpenSSH-argument.

---

## 8. Teststrategi & Mockning (SFTPStorageProvider.test.ts)

Idag innehåller `tests/main/SFTPStorageProvider.test.ts` över 1000 rader tester som mockar `ssh2-sftp-client`.

### Hur testerna anpassas:
1. Skapa en mock-klass `MockSftpPacketProtocol` som implementerar alla metoder i `SftpPacketProtocol`:
   ```typescript
   class MockSftpPacketProtocol {
     public init = vi.fn().mockResolvedValue(3);
     public stat = vi.fn();
     public lstat = vi.fn();
     public opendir = vi.fn().mockResolvedValue(Buffer.from('handle'));
     public readdir = vi.fn();
     public close = vi.fn().mockResolvedValue(undefined);
     public mkdir = vi.fn().mockResolvedValue(undefined);
     public rmdir = vi.fn().mockResolvedValue(undefined);
     public remove = vi.fn().mockResolvedValue(undefined);
     public rename = vi.fn().mockResolvedValue(undefined);
     public posixRename = vi.fn().mockResolvedValue(undefined);
     public setstat = vi.fn().mockResolvedValue(undefined);
     public read = vi.fn();
     public write = vi.fn().mockResolvedValue(undefined);
   }
   ```
2. I `tests/main/SFTPStorageProvider.test.ts`:
   Ersätt `vi.mock('ssh2-sftp-client')` med injektion av `MockSftpPacketProtocol` via providerns constructor.
3. Alla befintliga 40+ testfall (diffing, permissions, tidsstämplar, felkoder, delete root guard, rename retry) testas mot de mockade protokollanropen med exakt samma assertions!

---

## 9. Fasindelad Exekveringsordning

1. **Fas 1: Protokollkärnan**
   - Skapa `src/main/storage/sftp/SftpConstants.ts`.
   - Skapa `src/main/storage/sftp/SftpPacketProtocol.ts`.
   - Skapa `src/main/storage/sftp/SftpStreams.ts`.
   - Skriv och kör `tests/main/SftpPacketProtocol.test.ts` (100% grönt för paketparsning och streams).

2. **Fas 2: Process & Transport**
   - Skapa `src/main/storage/sftp/OpenSshSftpProcess.ts`.
   - Skriv och kör `tests/main/OpenSshSftpProcess.test.ts` (verifiera argument, askpass och presence).

3. **Fas 3: Integrera i SFTPStorageProvider**
   - Refaktorisera `SFTPStorageProvider.ts` att använda `OpenSshSftpProcess` och `SftpPacketProtocol`.
   - Implementera `provider.exec()` och `provider.createExecStream()`.
   - Uppdatera `RemoteSearchService.ts` och `FileTailService.ts`.
   - Uppdatera `tests/main/SFTPStorageProvider.test.ts`.

4. **Fas 4: UI & FIDO2/PIV Aktivering**
   - Uppdatera `IpcBridge.ts` (släpp igenom FIDO2 SFTP-konfiguration).
   - Uppdatera `SSHProfileForm.tsx` om det finns valideringsspärrar mot FIDO2 för SFTP.

5. **Fas 5: Städning & Slutverifiering**
   - Avinstallera `ssh2` och `ssh2-sftp-client` via `npm uninstall`.
   - Städa `vite.config.ts`.
   - Kör `npm run typecheck`, `npm run lint`, `npm test` och `pre-commit run --all-files`.
