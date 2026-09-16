# MultiSSH — Roadmap / TODO

Status som av 2026-09-15. Bygger på en genomgång av koden i `src/`, inte bara planen i
`docs/superpowers/plans/2026-09-14-multissh-implementation.md`.

## Vad finns idag

- **Terminal**: xterm.js-baserad flikad terminal, OpenSSH-process via `node-pty` (så
  `~/.ssh/config`, agent och default-nycklar fungerar precis som vanlig `ssh`).
  Smartcard/PKCS#11-inloggning via en lokal askpass-server + PIN-dialog.
- **Filhanterare**: dual-pane utforskare (lokal disk, SFTP, S3), drag-and-drop
  mellan paneler och från OS, breadcrumbs, sortering, multi-select, skapa/döp
  om/ta bort, överföringskö med progress/paus/avbryt.
- **Lagringsbackender**: Lokal disk, SFTP (`ssh2-sftp-client`, med
  agent/standardnyckel-fallback), S3 (AWS/MinIO/NetApp, path-style, självsignerat
  cert).
- **Anslutningshantering**: spara/redigera/ta bort SSH- och S3-profiler,
  bläddra-knapp för nyckelfiler via native dialog.
- **Paketering**: fungerande byggen för Linux (AppImage/deb/rpm) och Windows
  (NSIS + portabel exe).

## Kända begränsningar / teknisk skuld

Dessa är inte "features man kan välja bort" — de är luckor som en användare av ett
konkurrerande verktyg skulle uppfatta som buggar eller dealbreakers.

- **Smartcard-inloggning fungerar bara för terminalen, inte SFTP.** `ssh2`
  (JS-biblioteket) saknar PKCS#11-stöd helt, så en profil med
  `authType: smartcard` kan inte användas som SFTP-källa.
- **Inställningar är en stub.** Kugghjulet i TabBar visar bara en
  "inte implementerat än"-dialog.
- **Ingen appikon** — electron-builder varnade och föll tillbaka på Electrons
  standardikon.

## Prioriterad funktionslista

Rangordnad efter vad en användare av jämförbara verktyg (WinSCP, FileZilla,
Termius, MobaXterm, Royal TSX) skulle sakna mest — inte efter hur lätt de är
att bygga.

### P0 — Säkerhet (bör lösas innan produkten används mot riktiga miljöer)

- [x] **1. Kryptera profilstore.** Lösenord, lösenfraser, S3 secret key och session
   token krypteras nu med Electrons `safeStorage` (libsecret/Keychain/DPAPI) innan
   `profiles.json` skrivs till disk. Faller tillbaka till klartext med varning om
   ingen OS-nyckelring finns tillgänglig, och läser fortfarande gamla klartextfiler.
- [x] **2. Host key-verifiering för SFTP.** `ssh2`s `hostVerifier` jämförs nu mot
   `~/.ssh/known_hosts` (samma fil som OpenSSH, inkl. hashade poster och wildcards).
   Okänd eller ändrad värdnyckel visar en TOFU-dialog i UI:t ("värdnyckeln har
   ändrats, lita på den ändå?") istället för att tyst acceptera allt; accepterade
   nycklar sparas till known_hosts.
- [x] **3. Bekräftelse innan appen stängs med pågående överföringar.** Varnar via native dialog vid fönsterstängning och appavslut om aktiva eller väntande filöverföringar finns, med möjlighet att avbryta eller avsluta ändå.

### P1 — Kärnfunktioner man förväntar sig av vilken SFTP/SSH-klient som helst

- [ ] **4. Redigera fil direkt** ("öppna i extern editor, ladda upp automatiskt vid
   spara") — en av de mest använda funktionerna i WinSCP/FileZilla, saknas helt.
- [x] **5. Konflikthantering vid överföring** (skriv över/hoppa över/byt namn/fråga
   varje gång). `TRANSFER_ADD` kollar nu om målfilen redan finns och visar en
   dialog (Skriv över / Hoppa över / Byt namn, med "använd för alla återstående")
   istället för att tyst skriva över; "byt namn" hittar automatiskt en ledig
   "(n)"-variant. Kan även styras headless via `conflictPolicy` utan att fråga.
- [x] **6. Filsökning/filter i filhanteraren.** Sök-/filterruta och snabbknapp (Ctrl+F) i `FilePane`/`FileList`, matchningsräknare och specifik tom vy vid nollsök.
- [ ] **7. Katalogsynkronisering** (spegla lokal ↔ fjärrkatalog, visa diff innan
   överföring). Kärnfunktion i WinSCP; helt frånvarande här.
- [ ] **8. Permissions-editor (chmod)** för SFTP — `permissions` visas redan i
   listan men kan inte ändras.
- [x] **9. Standardkatalog/startsökväg per profil.** Stöd för `initialPath` i SSH-, SFTP- och S3-profiler med fält i profilformulären och direkt navigering vid anslutning i filhanteraren.
- [ ] **10. Utgående proxy (HTTP/SOCKS)** för att nå servrar bakom en
   företagsbrandvägg. Vanlig inställning i alla tre kategorierna
   (SSH/SFTP/S3) och helt frånvarande i `SSHConnectionConfig`/`SFTPConfig`/
   `S3Config` idag.
- [ ] **11. Anslutningstimeout, återförsök och automatisk återanslutning** vid
   nätverkstapp — idag finns bara paus/återuppta för överföringar, inget för
   själva sessionen.
- [ ] **12. Import/export av anslutningsprofiler** (t.ex. från `~/.ssh/config`,
   PuTTY, eller en enkel JSON-export) så man slipper mata in allt manuellt.
- [x] **13. Testa anslutning-knapp.** Implementerad i `SSHProfileForm` och `S3ProfileForm` via backend-anrop (`connection:test-ssh` och `connection:test-s3`) med visuell statusindikator och felrapportering innan profilen sparas.
- [ ] **14. Sessions-/flikpersistens.** Öppna flikar och senaste katalogsökväg per
   anslutning kommer inte ihåg mellan omstarter.
- [ ] **15. Checksumverifiering efter överföring** (t.ex. jämför storlek/hash) för
   att upptäcka trunkerade/korrupta filer.

### P2 — Det som gör en "Multi"-SSH-klient, inte bara "en SSH-klient" (och vanliga finjusteringar)

- [ ] **16. Broadcast/multi-exec: skicka samma tangenttryckningar till flera
   terminalflikar samtidigt.** Detta är den mest uppenbara luckan givet
   produktnamnet — funktionen finns i ClusterSSH, MobaXterm och Termius, men
   inte här. Naturlig utökning av befintlig `TabBar`/`TerminalView`.
- [ ] **17. Delad/grupperad vy** (flera terminaler sida vid sida i en flik, t.ex.
   2x2-grid) för att övervaka flera servrar samtidigt.
- [ ] **18. SSH-porttunnling** (lokal/fjärr/dynamisk SOCKS-proxy) — vanlig
   funktion i Termius/MobaXterm, ingen kod för det idag.
- [ ] **19. Jump host / ProxyJump-stöd i UI:t.** Fältet `extraOptions` finns redan i
   `SSHConnectionConfig` och skickas till `ssh` som `-o Key=Value` — så
   terminalen klarar det tekniskt redan — men `SSHProfileForm` exponerar
   inget fält för det, och SFTP/S3 saknar helt motsvarande stöd.
- [ ] **20. SSH-anslutningsalternativ i formuläret**: kompression (`Compression`),
   keep-alive-intervall (`ServerAliveInterval`), samt cipher/KEX/MAC-val för
   kompatibilitet med äldre servrar. Samma `extraOptions`-mekanism som ovan
   kan bära det, men inget UI för det idag.
- [ ] **21. Teckenkodning/charset-inställning** för filnamn — relevant mot äldre
   SFTP-servrar som inte pratar UTF-8.
- [ ] **22. S3-uppladdningsalternativ**: lagringsklass (Standard/IA/Glacier) och
   server-side encryption (SSE-S3/SSE-KMS) — `PutObjectCommand` i
   `S3StorageProvider` sätter inget av detta idag.
- [ ] **23. Sessionsloggning** — spara terminalens output till fil, användbart för
   felsökning och revision.
- [ ] **24. Profilorganisation i mappar/grupper** samt "senast använda"-lista i
   `ConnectionManagerModal`, som idag bara är en platt lista.

### P3 — Polering och plattformskänsla

- [ ] **25. Riktig inställningsskärm** (bakom det redan existerande kugghjulet):
   tema, typsnitt/storlek för terminalen, standardbeteende för nya flikar.
- [ ] **26. Ljust tema / systemtema-följning.** Just nu är allt hårdkodat mörkt.
- [ ] **27. Anpassningsbara tangentbordsgenvägar.**
- [ ] **28. Appikon + `desktopName`** för Linux (electron-builder varnar om båda
   idag).
- [ ] **29. Automatiska uppdateringar** (`electron-updater` eller motsvarande) —
   ingen uppdateringsmekanism finns alls just nu; paketen i Task 11 är
   engångsbyggen.
- [ ] **30. Bandbreddsbegränsning** för överföringar.
- [ ] **31. Arkivstöd** (packa upp/zippa filer på fjärrsystemet utan att ladda ner
   dem först).
- [ ] **32. Presigned URLs för S3-objekt** (dela en fil utan att ladda ner/upp den
   via klienten).
- [ ] **33. Multifönsterstöd** (öppna en andra appinstans/fönster).

## Föreslagen ordning att ta itu med det i

Om man bara får välja fem saker att göra näst: **1, 2, 5, 16, 13** — de täcker
det största säkerhetshålet, en vardagsbugg som drabbar alla förr eller senare
(tyst filöverskrivning), funktionen som faktiskt motiverar produktnamnet, och
en enkel UX-förbättring som förhindrar många supportfrågor ("varför kan jag
inte ansluta").
