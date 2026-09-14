# MultiSSH Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Skapa en modern krossplattforms skrivbordsapplikation (Linux & Windows) för SSH med xterm-terminal, Smartcard PKCS#11-autentisering, SFTP och S3-objektlagring (AWS/MinIO/NetApp) med visuell drag-and-drop och direkt strömmande filöverföring.

**Architecture:** Electron med isolerad main-process i TypeScript, `node-pty` för OpenSSH-terminal med PKCS#11-flagga och `SSH_ASKPASS`, enhetligt `StorageProvider`-gränssnitt för Lokalt, SFTP och S3 (`@aws-sdk/client-s3`), strömmande pipelining i minnet för drag-and-drop, samt en React 18 + Tailwind CSS frontend med flikhantering och dual-pane filhanterare.

**Tech Stack:** Electron, TypeScript, React 18, Vite, Tailwind CSS, Lucide React, xterm.js, node-pty, ssh2, ssh2-sftp-client, @aws-sdk/client-s3, @aws-sdk/lib-storage, Vitest.

---

### Task 1: Projekt- och byggkonfiguration (Scaffold & Build Setup)

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsconfig.node.json`
- Create: `vite.config.ts`
- Create: `tailwind.config.js`
- Create: `postcss.config.js`
- Create: `electron-builder.json`
- Create: `index.html`

- [ ] **Step 1: Skapa package.json med alla nödvändiga beroenden**

Skapa `package.json` med Electron, React, Vite, xterm, node-pty, ssh2, @aws-sdk/client-s3, @aws-sdk/lib-storage och testverktyget Vitest.

- [ ] **Step 2: Skapa TypeScript- och Vite-konfiguration**

Konfigurera `vite.config.ts` med `@vitejs/plugin-react` och electron integration, samt `tsconfig.json`.

- [ ] **Step 3: Skapa Tailwind CSS-konfiguration**

Konfigurera Tailwind och PostCSS för mörkt/ljust tema och modern terminal/filhanterar-styling.

- [ ] **Step 4: Skapa HTML-ingång och startfiler**

Skapa `index.html` som monterar React i `#root`.

- [ ] **Step 5: Verifiera att beroenden installeras och typcheck fungerar**

Kör: `npm install` (eller `pnpm/yarn`) och `npx tsc --noEmit`.

- [ ] **Step 6: Commit**

```bash
git add package.json tsconfig*.json vite.config.ts tailwind.config.js postcss.config.js index.html
git commit -m "chore: scaffold Electron + Vite + React + Tailwind project"
```

---

### Task 2: Unified Storage Engine & Datamodell

**Files:**
- Create: `src/shared/types/storage.ts`
- Create: `src/main/storage/StorageProvider.ts`
- Create: `src/main/storage/LocalStorageProvider.ts`
- Create: `tests/main/LocalStorageProvider.test.ts`

- [ ] **Step 1: Skriv enhetstest för LocalStorageProvider**

Testa listning av filer, `stat`, skapande av mappar, läsström och skrivström med Vitest.

- [ ] **Step 2: Kör testet för att verifiera att det fallerar**

Kör: `npx vitest run tests/main/LocalStorageProvider.test.ts`
Förväntat: FAIL (modul saknas).

- [ ] **Step 3: Implementera gemensamma typer och LocalStorageProvider**

Implementera `src/shared/types/storage.ts` och `LocalStorageProvider.ts` med stöd för Linux och Windows sökvägar.

- [ ] **Step 4: Kör testet igen för att verifiera att det passerar**

Kör: `npx vitest run tests/main/LocalStorageProvider.test.ts`
Förväntat: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/types/storage.ts src/main/storage/ tests/main/LocalStorageProvider.test.ts
git commit -m "feat(storage): implement StorageProvider interface and LocalStorageProvider"
```

---

### Task 3: S3 Storage Provider (AWS, MinIO, NetApp)

**Files:**
- Create: `src/main/storage/S3StorageProvider.ts`
- Create: `tests/main/S3StorageProvider.test.ts`

- [ ] **Step 1: Skriv enhetstest för S3StorageProvider**

Testa inställning av anpassad endpoint (MinIO/NetApp), Path-Style addressing (`forcePathStyle: true`), hantering av självsignerade TLS-certifikat, bucket- och prefixlistning, samt `createReadStream` och `createWriteStream` (via multipart upload).

- [ ] **Step 2: Kör testet för att verifiera att det fallerar**

Kör: `npx vitest run tests/main/S3StorageProvider.test.ts`
Förväntat: FAIL.

- [ ] **Step 3: Implementera S3StorageProvider med AWS SDK v3**

Implementera `S3Client`, `ListObjectsV2Command`, `GetObjectCommand`, `PutObjectCommand`, `DeleteObjectCommand` och `@aws-sdk/lib-storage` `Upload`.

- [ ] **Step 4: Kör testet för att verifiera att det passerar**

Kör: `npx vitest run tests/main/S3StorageProvider.test.ts`
Förväntat: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/storage/S3StorageProvider.ts tests/main/S3StorageProvider.test.ts
git commit -m "feat(storage): implement S3StorageProvider for AWS, MinIO, and NetApp"
```

---

### Task 4: SFTP Storage Provider

**Files:**
- Create: `src/main/storage/SFTPStorageProvider.ts`
- Create: `tests/main/SFTPStorageProvider.test.ts`

- [ ] **Step 1: Skriv enhetstest med mockad SSH2/SFTP-session**

Verifiera mappnavigering, felläsning, behörigheter och strömningsstöd.

- [ ] **Step 2: Kör testet för att verifiera att det fallerar**

Kör: `npx vitest run tests/main/SFTPStorageProvider.test.ts`
Förväntat: FAIL.

- [ ] **Step 3: Implementera SFTPStorageProvider**

Implementera anslutning via `ssh2` och SFTP client med metoder för `list`, `stat`, `createFolder`, `delete`, `rename`, `createReadStream` och `createWriteStream`.

- [ ] **Step 4: Kör testet för att verifiera att det passerar**

Kör: `npx vitest run tests/main/SFTPStorageProvider.test.ts`
Förväntat: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/storage/SFTPStorageProvider.ts tests/main/SFTPStorageProvider.test.ts
git commit -m "feat(storage): implement SFTPStorageProvider"
```

---

### Task 5: Direkt Strömmande Transfer Pipeline (SFTP ⇄ S3 ⇄ Lokalt)

**Files:**
- Create: `src/main/transfer/TransferPipeline.ts`
- Create: `src/main/transfer/TransferQueue.ts`
- Create: `tests/main/TransferPipeline.test.ts`

- [ ] **Step 1: Skriv enhetstest för strömmande överföring mellan providers**

Testa att överföring sker direkt från en läsström till en skrivström utan att temporära filer skrivs till disk. Verifiera att bytes räknas och progress events skickas med beräknad hastighet.

- [ ] **Step 2: Kör testet för att verifiera att det fallerar**

Kör: `npx vitest run tests/main/TransferPipeline.test.ts`
Förväntat: FAIL.

- [ ] **Step 3: Implementera TransferPipeline och TransferQueue**

Använd Node.js `stream.Transform` och `stream.pipeline` för att monitorera byte-flödet i realtid och hantera avbrytning/pausning via `AbortController`.

- [ ] **Step 4: Kör testet för att verifiera att det passerar**

Kör: `npx vitest run tests/main/TransferPipeline.test.ts`
Förväntat: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/transfer/ tests/main/TransferPipeline.test.ts
git commit -m "feat(transfer): implement direct memory streaming transfer pipeline and queue"
```

---

### Task 6: Smartcard (PKCS#11) & OpenSSH PTY Engine

**Files:**
- Create: `src/main/smartcard/SmartcardDetector.ts`
- Create: `src/main/smartcard/AskpassServer.ts`
- Create: `src/main/ssh/SSHPtyManager.ts`
- Create: `tests/main/SmartcardDetector.test.ts`

- [ ] **Step 1: Skriv enhetstest för Smartcard-biblioteksdetektering**

Testa standardstigar för Linux (`libiidp11.so`, `opensc-pkcs11.so`) och Windows (`iidp11.dll`, `opensc-pkcs11.dll`) samt flaggkonstruktion för OpenSSH (`ssh -I <path>`).

- [ ] **Step 2: Kör testet för att verifiera att det fallerar**

Kör: `npx vitest run tests/main/SmartcardDetector.test.ts`
Förväntat: FAIL.

- [ ] **Step 3: Implementera SmartcardDetector, AskpassServer och SSHPtyManager**

Implementera:
1. `SmartcardDetector` som kontrollerar om biblioteken existerar på systemet och validerar sökvägar.
2. `AskpassServer` som sätter upp en lokal IPC-server för `SSH_ASKPASS` för säker PIN-inmatning från användaren.
3. `SSHPtyManager` som spawnar OpenSSH via `node-pty` med stöd för fönsterstorlek (resize), terminaldata, smartkortsflagga `-I` och SSH-agent.

- [ ] **Step 4: Kör testet för att verifiera att det passerar**

Kör: `npx vitest run tests/main/SmartcardDetector.test.ts`
Förväntat: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/smartcard/ src/main/ssh/ tests/main/SmartcardDetector.test.ts
git commit -m "feat(ssh): implement Smartcard PKCS#11 detector, Askpass server and SSH PTY manager"
```

---

### Task 7: Electron Main Entry & Preload IPC Bridge

**Files:**
- Create: `src/main/index.ts`
- Create: `src/preload/index.ts`
- Create: `src/shared/types/ipc.ts`

- [ ] **Step 1: Definiera typade IPC-kanaler i ipc.ts**

Exponera SSH-terminalhantering, Smartcard-detektering, filbläddring (StorageProvider) och överföringskö.

- [ ] **Step 2: Implementera contextBridge i src/preload/index.ts**

Exponera säkert `window.multissh` med strikt context isolation.

- [ ] **Step 3: Implementera Electron Main fönster- och livscykelhantering i src/main/index.ts**

Registrera IPC-lyssnare och hantera säker fönsterskapande.

- [ ] **Step 4: Verifiera att Electron-processen startar och typkontroll passerar**

Kör: `npx tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add src/main/index.ts src/preload/index.ts src/shared/types/ipc.ts
git commit -m "feat(electron): implement main process lifecycle and secure preload IPC bridge"
```

---

### Task 8: Renderer UI – Flikhantering & Terminal (xterm.js)

**Files:**
- Create: `src/renderer/src/App.tsx`
- Create: `src/renderer/src/components/TabBar.tsx`
- Create: `src/renderer/src/components/TerminalView.tsx`
- Create: `src/renderer/src/components/SmartcardPinModal.tsx`

- [ ] **Step 1: Implementera TabBar med stöd för Terminal- och Filhanterarflikar**

Möjlighet att öppna nya flikar, byta flik och stänga flikar.

- [ ] **Step 2: Implementera TerminalView med xterm.js och FitAddon**

Integrera terminalen med IPC: lyssna på data från PTY, skicka inmatning och hantera fönsteromskalning.

- [ ] **Step 3: Implementera SmartcardPinModal**

Säker dialog som poppar upp när OpenSSH begär PIN för smartkortet.

- [ ] **Step 4: Verifiera att komponenten bygger och renderas**

Kör: `npm run build` för renderern.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/TabBar.tsx src/renderer/src/components/TerminalView.tsx src/renderer/src/components/SmartcardPinModal.tsx src/renderer/src/App.tsx
git commit -m "feat(ui): implement tab management, xterm.js terminal view, and smartcard PIN modal"
```

---

### Task 9: Renderer UI – Dual-Pane Filhanterare med Drag-and-Drop

**Files:**
- Create: `src/renderer/src/components/FileManager/DualPaneExplorer.tsx`
- Create: `src/renderer/src/components/FileManager/FilePane.tsx`
- Create: `src/renderer/src/components/FileManager/FileList.tsx`
- Create: `src/renderer/src/components/FileManager/Breadcrumbs.tsx`
- Create: `src/renderer/src/components/FileManager/DragDropLayer.tsx`
- Create: `src/renderer/src/components/FileManager/TransferQueueDrawer.tsx`

- [ ] **Step 1: Implementera FilePane och FileList**

Visning av ikoner (mapp, filtyper), storlek, ändringsdatum, sortering, och flerval (shift/ctrl-klick).

- [ ] **Step 2: Implementera Breadcrumbs och källväljare (Source Selector: Local, SFTP, S3)**

Väljare för vad varje panel visar med direktadressfält.

- [ ] **Step 3: Implementera HTML5 Drag-and-Drop i DragDropLayer**

Hantera `dragstart`, `dragover`, `dragleave` och `drop` mellan vänster och höger panel samt från operativsystemets filhanterare.

- [ ] **Step 4: Implementera TransferQueueDrawer**

Lådmeny längst ner i appen som visar aktiva överföringar, progress bar, hastighet i MB/s och avbryt-knapp.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/FileManager/
git commit -m "feat(ui): implement dual-pane file explorer with visual drag-and-drop and transfer queue"
```

---

### Task 10: Renderer UI – Anslutningshanterare (SSH & S3 Profiler)

**Files:**
- Create: `src/renderer/src/components/ConnectionModal/ConnectionManagerModal.tsx`
- Create: `src/renderer/src/components/ConnectionModal/SSHProfileForm.tsx`
- Create: `src/renderer/src/components/ConnectionModal/S3ProfileForm.tsx`

- [ ] **Step 1: Implementera SSHProfileForm**

Formulär för värdnamn, port, användare, samt val av autentisering: Lösenord, SSH-nyckel, SSH-agent eller **Smartcard (PKCS#11)** med dropdown för kända bibliotek (Net iD, OpenSC) och bläddra-knapp.

- [ ] **Step 2: Implementera S3ProfileForm**

Formulär för S3: Namn, Endpoint (AWS, MinIO, NetApp), Region, Access/Secret Key, checkbox för `forcePathStyle`, och kryssruta för självsignerade certifikat / anpassad CA.

- [ ] **Step 3: Implementera ConnectionManagerModal och lokal krypterad lagring**

Spara och hantera bokmärken/profiler för snabbanslutning med ett klick.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/ConnectionModal/
git commit -m "feat(ui): implement connection profile manager for SSH smartcards and S3 endpoints"
```

---

### Task 11: End-to-End Verifiering och Byggpaket

**Files:**
- Modify: `package.json` (byggskript för Linux och Windows)
- Create: `tests/e2e/workflow.test.ts`

- [ ] **Step 1: Kör fullständiga enhetstester och typvalidering**

Kör: `npm test` och `npm run lint`.
Förväntat: Samtliga tester och typcheck passerar utan fel.

- [ ] **Step 2: Testa paketeringsbygge**

Kör: `npm run package:linux` (och verifiera konfiguration för Windows).
Förväntat: Byggfil genereras i `dist/`.

- [ ] **Step 3: Commit**

```bash
git add package.json electron-builder.json tests/e2e/
git commit -m "chore(build): configure cross-platform build scripts and e2e test suite"
```
