# sshs3 — Roadmap / TODO

Status som av 2026-09-27. Bygger på en genomgång av koden i `src/`, inte bara planen i
`docs/superpowers/plans/2026-09-14-multissh-implementation.md`.

## Vad finns idag

- **Terminal**: xterm.js-baserad flikad terminal, OpenSSH-process via `node-pty` (så
  `~/.ssh/config`, agent och default-nycklar fungerar precis som vanlig `ssh`), rekursiv split-vy (Konsole-stil)
  med oberoende sessioner, realtidsspårning av värdnamn och kommandon i fliktitlar samt kortkommandon (`Ctrl++`/`Ctrl+-`/`Ctrl+0`) för fontstorlek.
  Smartcard/PKCS#11-inloggning via en lokal askpass-server + PIN-dialog och FIDO2/YubiKey resident-nycklar med visuell touch-presence banner.
- **Filhanterare**: dual-pane utforskare (lokal disk, SFTP, S3, K8s poddar), drag-and-drop
  mellan paneler och från OS, breadcrumbs som droppmål, sortering, multi-select, skapa/döp
  om/ta bort, överföringskö med progress/paus/avbryt, permissions-editor (`chmod`), inbyggd filredigerare med live Markdown-preview samt live streaming loggvisare (`tail -f`).
- **Katalogsynkronisering (Diff & Sync)**: komplett mappjämförelse (lokal disk, SFTP och S3) med diff på storlek och ändringstid (`mtime`), interaktiv filjämförelse, selektiv synkning och sparade synkprofiler.
- **Kubernetes & OpenShift**: automatisk klusterupptäckt via `~/.kube/config`, interaktiva pod exec-terminaler, live loggvisning med text-sökning, pod-filutforskare utan behov av container-agenter samt `kubectl debug` ephemeral containers med verktygsprofiler (Netshoot m.fl.) och `oc login`-stöd.
- **X11-forwarding**: inbyggd portabel VcXsrv-server på Windows med automatisk brandväggskonfiguration och on-demand/always-on-startlägen.
- **Fjärrsynkronisering av profiler**: zero-knowledge AES-256-GCM-kryptering till egen S3-hink eller SFTP-server med hårdvaruupplåsning via smartcard/token och automatisk synkning till hanterat block i `~/.ssh/config`.
- **Lagringsbackender**: Lokal disk, SFTP (OpenSSH-baserad motor, `ssh -s sftp`, med FIDO2, smartcard och `~/.ssh/config`), S3 (AWS med AWS SSO OIDC / MinIO / NetApp, path-style, självsignerat cert).
- **Anslutningshantering**: spara/redigera/ta bort SSH- och S3-profiler, mappar/gruppering, import från `~/.ssh/config` samt JSON backup export/import.
- **Paketering**: fungerande byggen för Linux (AppImage/deb/rpm) och Windows
  (NSIS installer med VcXsrv + portabel exe).

## Kända begränsningar / teknisk skuld

Dessa är luckor som en användare av ett konkurrerande verktyg skulle uppfatta som begränsningar:

- **Automatiska uppdateringar är avstängda på Windows** — `electron-updater` är
  inkopplad (se #29), men Windows-bygget är osignerat så updatern kan inte verifiera
  utgivaren (`win.publisherName`), bara sha512 från `latest.yml`.
- **`PKCS11Provider`/`SecurityKeyProvider` i synkad `extraOptions` är medvetet inte spärrade** —
  beslut 2026-10-05. Synkdata är AES-256-GCM-krypterad och autentiserad (nyckel via scrypt från
  huvudlösenordet), så en manipulerad fil i SFTP/S3 avvisas; ingen extra SHA-256-koll behövs. Att
  spärra direktiven i `BLOCKED_SSH_DIRECTIVES` skulle även strippa lokalt genererade
  smartcard-rader ur `~/.ssh/config`. Kvarvarande risk: en komprometterad egen klient kan pusha
  en skadlig `extraOptions`. `pkcs11LibPath` är redan device-local (synkas aldrig). Ta upp igen
  bara om hotbilden ändras (t.ex. delad synk-källa mellan flera användare).
- **Smartcard-filtret (auth-certifikat, 0.96.26) har kända luckor** — från kodgranskningen
  2026-10-06. Filtret ligger i `getOrLoadGlobalSmartcardAgent` (`IpcBridge.ts`) och
  `AppAgent.removeIdentities`.
  - Filtrerar bara *agent-global*. Per-session-agenter (`loadSmartcardIntoPrivateAgentWithPresence`)
    och sync-länkning/-upplåsning via privat agent laddar fortfarande alla nycklar (kan ge
    `MaxAuthTries`-fel). Samma urval (`selectAuthFingerprints`) bör användas där.
  - En länkad sync-nyckel som inte är auth-capable läggs i samma mängd som styr pinning
    (`globalCards[..].fingerprints`) och erbjuds därför mot servrar och syns i identitetslistan.
    Behöver en separat "behåll men erbjud inte"-mängd; sync-valet (`identitiesForLibrary`) använder
    den mängd som idag är gemensam.
  - Ny sync-länkning tar `identities[0]` ur den filtrerade listan, så vald nyckel kan skilja sig från
    förr; två moduler för samma kort (p11-kit-proxy/OpenSC) kan ge olika ordning. Överväg att
    sortera deterministiskt eller låta användaren välja nyckel vid länkning.
  - Windows: `removeIdentities` gör inget (delad agenttjänst) och ingen `IdentitiesOnly`-pinning
    finns där, så signeringsnycklar kan fortfarande erbjudas. Ett misslyckat `ssh-add -d` loggas
    bara (`removed 0 of N`) utan synlig signal för användaren.
  - Städning: `removeIdentities` dubblerar mappsetup och `.pub`-rad från `writePublicKeyFiles`
    (dela hjälpare) och kör ett `ssh-add -d` per nyckel i `addQueue`; ett anrop med flera filer
    räcker. `readKeyUsageFirstByte` dubblerar DER-loopen i `extractUpnFromCertificateDer`
    (gemensam `findExtension(der, oid)`; en felformad Key Usage-OCTET STRING hanteras olika).
    `selectAuthFingerprints` läser sync-konfigen vid varje kortladdning även när inget behöver
    skyddas.
- **Multifönster saknas** — applikationen körs i dagsläget i ett samlat fönster per instans.

## Prioriterad funktionslista

Rangordnad efter vad en användare av jämförbara verktyg (WinSCP, FileZilla,
Termius, MobaXterm, Royal TSX) skulle sakna mest — inte efter hur lätt de är
att bygga.

### P0 — Säkerhet (bör lösas innan produkten används mot riktiga miljöer)

- [x] **1. Kryptera profilstore.** Lösenord, lösenfraser, S3 secret key och session
   token krypteras nu med Electrons `safeStorage` (libsecret/Keychain/DPAPI) innan
   `profiles.json` skrivs till disk. Faller tillbaka till klartext med varning om
   ingen OS-nyckelring finns tillgänglig, och läser fortfarande gamla klartextfiler.
- [x] **2. Host key-verifiering för SFTP.** SFTP körs över systemets OpenSSH-klient, som jämför mot
   `~/.ssh/known_hosts` (inkl. hashade poster och wildcards). Okänd värdnyckel visar en TOFU-dialog i UI:t
   (via askpass-frågan "continue connecting"), avvisas om inget fönster finns (fail closed); en ändrad
   nyckel vägras av OpenSSH. Accepterade nycklar sparas till known_hosts.
- [x] **3. Bekräftelse innan appen stängs med pågående överföringar.** Varnar via native dialog vid fönsterstängning och appavslut om aktiva eller väntande filöverföringar finns, med möjlighet att avbryta eller avsluta ändå.

### P1 — Kärnfunktioner man förväntar sig av vilken SFTP/SSH-klient som helst

- [x] **4. Redigera fil direkt** ("öppna i extern editor, ladda upp automatiskt vid spara") — `FileEditorService` laddar ner fjärrfiler temporärt, öppnar i OS standardeditor via `shell.openPath`, övervakar med `fs.watch` och laddar automatiskt upp ändringar tillbaka till SFTP/S3 vid sparning med statusnotis och sessionsstädning.
- [x] **5. Konflikthantering vid överföring** (skriv över/hoppa över/byt namn/fråga
   varje gång). `TRANSFER_ADD` kollar nu om målfilen redan finns och visar en
   dialog (Skriv över / Hoppa över / Byt namn, med "använd för alla återstående")
   istället för att tyst skriva över; "byt namn" hittar automatiskt en ledig
   "(n)"-variant. Kan även styras headless via `conflictPolicy` utan att fråga.
- [x] **6. Filsökning/filter i filhanteraren.** Sök-/filterruta och snabbknapp (Ctrl+F) i `FilePane`/`FileList`, matchningsräknare och specifik tom vy vid nollsök.
- [x] **7. Katalogsynkronisering (Diff & Sync)** — Komplett katalogsynkronisering implementerad via `DirectorySyncModal`, `DirectorySyncService` och `DirSyncSavedProfilesModal`. Stöder diff och synkning mellan lokal disk, SFTP och S3 med ändringstidsstämpel (`mtime`) och storleksjämförelse, interaktiv filjämförelse ("Compare"), selektiv körning och sparade synkprofiler.
- [x] **8. Permissions-editor (chmod)** för SFTP och lokal lagring. Rättighetskolumn visas i listan med sortering, och en interaktiv chmod-modal (User/Group/Other kryssrutor, oktal representation och rekursivt val) kan öppnas via knapp i verktygsraden.
- [x] **9. Standardkatalog/startsökväg per profil.** Stöd för `initialPath` i SSH-, SFTP- och S3-profiler med fält i profilformulären och direkt navigering vid anslutning i filhanteraren.
- [x] **10. Utgående proxy (HTTP / SOCKS4 / SOCKS5)** för att nå servrar bakom företagsbrandväggar. Stöd för SSH (OpenSSH `ProxyCommand` med `proxyCli.cjs` för autentisering), SFTP (OpenSSH `ProxyCommand` via `proxyCli.cjs`, samma som terminalen) och S3 (`NodeHttpHandler` med proxy-agenter). Profilformulären har expanderbar proxysektion och proxylösenord krypteras säkert via `safeStorage`.
- [x] **11. Anslutningstimeout, återförsök och automatisk återanslutning** — Stöd för `sessionExitAction` ('reconnect' | 'close' | 'keep') under Inställningar med återanslutningsoverlay i `TerminalView`, automatisk återanvändning av cachad agent vid återanslutning, samt `ServerAliveInterval` för att förhindra tysta nätverkstapp.
- [x] **12. Import/export av anslutningsprofiler** — Import från `~/.ssh/config` (`importSshConfigFile` / `SshConfigImporter`) med modal för att välja vilka värdar som ska importeras till valfri mapp, samt Export och Import av JSON Backup direkt i `ConnectionManagerModal`.
- [x] **13. Testa anslutning-knapp.** Implementerad i `SSHProfileForm` och `S3ProfileForm` via backend-anrop (`connection:test-ssh` och `connection:test-s3`) med visuell statusindikator och felrapportering innan profilen sparas.
- [x] **14. Sessions-/flikpersistens.** Öppna terminal- och filflikar samt senast besökta katalogsökvägar sparas och återställs automatiskt mellan omstarter via `SessionStore` (`session.json`).
- [x] **15. Checksumverifiering efter överföring** (jämför storlek och hash) för att upptäcka trunkerade/korrupta filer — `ByteMeter` beräknar rullande SHA-256 och MD5 under strömning, och `TransferPipeline` verifierar målstorlek och kryptografiska kontrollsummor post-transfer med automatisk radering vid avvikelse samt inställning i `SettingsModal`.
- [ ] **34. Stöd för PuTTY Private Key (.ppk-filer)** — automatisk konvertering/parsnig
   av `.ppk` (PuTTY v2 och v3) till OpenSSH-format så att befintliga PuTTY-nycklar kan
   användas utan manuell omvandling via PuTTYgen.
- [x] **35. Öppna terminal i aktuell katalog ("Open in Terminal")** — klassisk
   WinSCP-funktion: terminalknapp i SFTP-panelens verktygsrad (`FilePane`) som slår
   upp SSH-profilen bakom SFTP-anslutningen och öppnar en ny terminalflik som `cd`:ar
   till samma fjärrsökväg efter att prompten visats.
- [ ] **36. Bokmärken / Favoritsökvägar i filhanteraren** — snabbåtkomstmeny i
   `FilePane` för att spara och snabbhoppa till ofta använda mappar på lokal disk,
   SFTP och S3.
- [x] **37. Inbyggd snabbviewer/editor för textfiler** — modal-editor (`FileEditorModal`) med synkroniserade radnummer, monospace, textinläsning/sparning till Local/SFTP/S3, inbyggd sökning (Ctrl+F), radbrytningsväxlare (Word Wrap), läsläge (Read-Only toggle), binär-/storleksvarning samt dirty-hantering och sparningsstatus (`yyyy-mm-dd HH:mm`). Integrerad via dubbelklick, verktygsradsknapp och kontextmeny ("Visa / Redigera" och "Öppna i extern editor").
- [ ] **38. S3 Bucket-administration: Skapa, radera och tömma bucket (Purge)** —
   hantera hela livscykeln för buckets direkt i UI:t, inklusive regionval vid skapande
   och rekursiv tömning av objekt och versioner inför radering.
- [x] **57. Dynamisk AWS-autentisering (IAM/SSO).** Ny `AwsSsoAuthService` (i samma anda
   som Askpass-servern på SSH-sidan) driver OIDC-enhetsflödet (`RegisterClient` →
   `StartDeviceAuthorization` → polling av `CreateToken`) via `@aws-sdk/client-sso-oidc`/
   `@aws-sdk/client-sso`, öppnar webbläsaren automatiskt och cachar token i samma
   `~/.aws/sso/cache/*.json`-format som `aws sso login` (kompatibelt med AWS CLI).
   `S3ProfileForm` har fått en Access Keys/AWS SSO-växlare med Konto/Roll-väljare
   (`awsSsoListAccounts`/`awsSsoListRoles`) och en `AwsSsoLoginModal` för kod/väntanläge.
   `S3StorageProvider` använder `fromSSO()` som credentials-provider (auto-uppdateras av
   AWS SDK) när `authMode: 'sso'`.
- [x] **58. "Tail -f" och streaming av loggfiler** — `FileTailService` i backend och live loggströmning i `FileEditorModal` med paus/återuppta, automatisk skrollning och textsökning för stora växande loggfiler på SFTP och lokal disk utan att ladda gigantiska filer i minnet.

### P2 — Det som gör en "Multi"-SSH-klient, inte bara "en SSH-klient" (och vanliga finjusteringar)

- [ ] **16. Broadcast/multi-exec: skicka samma tangenttryckningar till flera
   terminalflikar samtidigt.** Detta är den mest uppenbara luckan givet
   produktnamnet — funktionen finns i ClusterSSH, MobaXterm och Termius, men
   inte här. Naturlig utökning av befintlig `TabBar`/`TerminalView`.
- [x] **17. Delad/grupperad vy** (flera terminaler sida vid sida i en flik, t.ex. 2 kolumner, 2 rader och 2x2-grid). Integrerat i `App.tsx` med verktygsfält för layoutbyte, oberoende terminalpaneler med anslutningsväljare och full sessionspersistens.
- [x] **18. SSH-porttunnling** (lokal `-L`, fjärr `-R` och dynamisk SOCKS-proxy `-D`). Hanteras som fristående bakgrundsprocesser (`ssh -N`) via en dedikerad SSH Tunnels-panel i verktygsraden med live status, namngivna tunnlar, in-place editering och automatisk portkollisionskontroll.
- [x] **19. Jump host / ProxyJump-stöd i UI:t.** Stöd för att antingen peka på en annan sparad profil (`proxyJumpProfileId`) eller manuell bastion-sträng. Stöds fullt ut i terminaler (`-J`), SFTP (`-J`, hanteras av OpenSSH), samt exporterat till `ProxyJump <alias>` i `~/.ssh/config`.
- [x] **20. SSH-anslutningsalternativ i formuläret**: kompression (`Compression`), keep-alive (`ServerAliveInterval`), samt valbara ciphers, KEX och MAC-algoritmer för både terminal och SFTP-anslutningar.
- [ ] **21. Teckenkodning/charset-inställning** för filnamn — relevant mot äldre
   SFTP-servrar som inte pratar UTF-8.
- [ ] **22. S3-uppladdningsalternativ**: lagringsklass (Standard/IA/Glacier) ⬜ och
   server-side encryption (SSE-S3/SSE-KMS) ✅ — `serverSideEncryption`/`kmsKeyId` i
   `S3Config` skickas nu med på både `Upload` (filuppladdning) och mapp-markörens
   `PutObjectCommand` i `S3StorageProvider`, med en dropdown + KMS Key ID-fält i
   `S3ProfileForm`. Lagringsklass (Standard/IA/Glacier) är fortfarande inte implementerat.
- [ ] **23. Sessionsloggning** — spara terminalens output till fil, användbart för
   felsökning och revision.
- [x] **24. Profilorganisation i mappar/grupper** samt "senast använda"-lista i
   `ConnectionManagerModal` med tidsstämplar (`yyyy-mm-dd HH:mm`), expanderbara/kollapsbara mappgrupper med profilräknare och integrerad direkt-anslutning.
- [x] **39. PuTTY Terminal-UX: Kopiera-vid-markering (Copy on select)** — valbart under Inställningar (`copyOnSelect`), integrerat i `TerminalView` så att markering av text i terminalen automatiskt kopierar den till operativsystemets urklipp.
- [ ] **40. Sökning i terminalbuffert & scrollback-hantering** — sökfunktion (`Ctrl+Shift+F` med matchningsmarkering och navigering upp/ned i historiken) samt buffertstorleksinställning (`terminalScrollback` finns redan i Settings).
- [x] **41. SSH Agent Forwarding (`-A`)** — valbart per profil i `SSHProfileForm` (`forwardAgent`), skickas till OpenSSH (`ForwardAgent=yes`) via `SmartcardDetector` och stöder vidarehoppning för både terminal och SFTP-sessioner.
- [ ] **42. Synkroniserad bläddring (Synchronized browsing)** — WinSCP-funktion: vid navigering i undermappar i vänster panel följer höger panel automatiskt med till samma mappnamn om det existerar.
- [ ] **43. Beräkna katalogstorlek (Recursive size / `du`)** — visa sammanlagd storlek och antal filer för markerade mappar i SFTP och S3 via kontextmenyn.
- [x] **44. Bevara tidsstämplar (mtime) vid filöverföring** — `setModifiedTime` implementerad i `LocalStorageProvider` och `SFTPStorageProvider`, bevarar källfilens originaldatum vid katalogsynkronisering och överföringar.
- [ ] **45. Filmasker och exkluderingsfilter vid överföring** — uteslut mönster som `node_modules/`, `.git/`, `*.tmp`, `.DS_Store` vid överföring av mappar och synkning.
- [ ] **59. "Run script on host" — kör skript direkt från filhanteraren.** Terminalen och
   SFTP-filhanteraren är idag två separata världar trots att de pratar med samma maskin.
   Bygg vidare på befintlig "Open in Terminal" (#35): högerklick på ett skript (`.sh`,
   `.py` osv.) i SFTP-panelen ska ge ett val att köra det direkt i den tillhörande
   SSH-terminalfliken, istället för att bara öppna en tom prompt i samma katalog.
- [x] **60. Smarta Git-indikatorer i SFTP-vyn och Git & GitHub-panel** — Automatisk avkänning av Git-repositorier på fjärrservrar (SFTP) och lokal disk via `GitStatusService` och `RemoteGitService`. Visar grennamn, ändringsindikator (`*`), commits ahead/behind (`↑`/`↓`), Git Pull, Git Clone och direktlänk till GitHub/GitLab. Inkluderar centraliserad **Settings > Git & GitHub** med Developer SSH Keys (kopiera, registrera på GitHub/GitLab), kryptografisk commit-signering (`~/.gitconfig`, `gpg.format=ssh`, `commit.gpgsign`, `allowed_signers`), public key lookup (`username.keys`), import av dotfiles från Git-repositorier samt inställning för att slå av/på Git-integrationen i filhanteraren.
- [x] **64. Certifikatdetaljer i "Cached smartcard identities".** Popovern (kort-ikonen
   i toppfältet, `TabBar.tsx`) listade tidigare bara vad `ssh-add -l` rapporterar
   (fingerprint/keytype/PIV-slotetikett) — ingen certifikatinfo. Varje identitet kan nu
   expanderas till Subject CN, UPN (Microsoft `otherName`-SAN, vanligt på PIV/CAC/SITHS)
   och giltighetstid. Läser certifikatet direkt från samma PKCS#11-modul (`.so`/`.dll`)
   som redan används för `ssh-add -s` (`SmartcardCertificateReader.ts`, via `pkcs11js`)
   istället för att shella ut till OpenSC:s `pkcs11-tool` — det verktyget saknas helt hos
   t.ex. Net iD-användare som bara har PKCS#11-biblioteket, inte OpenSC:s CLI-paket.
   Matchning mot rätt `ssh-add`-identitet sker via en egenberäknad SSH-fingerprint av
   certifikatets publika nyckel (`CertificateParser.ts`), inte via CKA_ID/etikett som
   varierar mellan leverantörer. UPN extraheras med en liten handskriven DER-parser
   (Node's inbyggda `X509Certificate` avkodar inte Microsofts UPN-OID). Nytt native
   npm-beroende (`pkcs11js`) — byggs redan idag av electron-builders befintliga
   native-rebuild-steg (samma mekanism som `node-pty`).
- [x] **63. FIDO2/WebAuthn-nycklar (`sk-ecdsa-sha2-nistp256@openssh.com` /
   `sk-ssh-ed25519@openssh.com`) som eget autentiseringsspår** — Stöd för hårdvarunycklar (YubiKey m.fl.) med resident/discoverable keys discovery via `ykman`/`ssh-keygen`, visuell touch-presence banner i applikationen vid fysisk beröringsbegäran, managed agent lifecycle samt multiplexad dotfiles-synkning över befintliga FIDO2-sessioner utan extra fysiska beröringar.
- [x] **46. S3 Versionshantering (Versioning)** — `S3StorageProvider` stöder `listObjectVersions`/`deleteObjectVersion`/`restoreObjectVersion` samt `getBucketVersioning`/`setBucketVersioning`. `VersionsModal` i filhanteraren visar tidigare versioner och raderingsmarkörer med återställning/permanent radering för objekt, och aktivera/pausa-knapp för bucket-nivå.
- [ ] **47. S3 Metadata & HTTP-headers editor** — granska och redigera `Content-Type`, `Cache-Control`, `Content-Disposition` och anpassade användarmetadata (`x-amz-meta-*`) för valda objekt.
- [x] **48. S3 Bucket Policy & CORS-redigerare** — `BucketPolicyModal` med flikar för JSON-policy och CORS-regler, backat av `getBucketPolicy`/`setBucketPolicy`/`getBucketCors`/`setBucketCors` i `S3StorageProvider`, nås via bucket-kontextmenyn.

- [x] **68. Installera publik nyckel i `authorized_keys` (ssh-copy-id).** `KeyInstallService` kör ett fast,
   idempotent POSIX-skript över OpenSSH (jump host/proxy från profilen, askpass för lösen/PIN/touch/hostkey-TOFU,
   OpenSSH faller själv tillbaka till lösen om profilens nyckel inte accepteras). Flera nycklar (fil, agent,
   FIDO2, PIV, inklistrad) väljs i `InstallKeyModal` och går på stdin i en enda anslutning. Verifierar
   nyckelinloggning för oskyddade nyckelfiler, och ger en kopierbar one-liner när hosten inte nås från appen.
   Knapp i profillistan och avsnittet **Access** i profilformuläret, som kör en synlig kedja på den osparade
   profilen (Reach host → Host key → Login methods → Key installed → Login works) via en tyst probe
   (`PreferredAuthentications=none`, inga PIN/touch) och ett riktigt inloggningstest. Inloggning för installationen
   följer regeln "logga aldrig in med nyckeln du installerar" (`chooseLoginOrder`). Mjuk påminnelse vid Spara av ny,
   overifierad nyckelprofil. Ej med: full wizard, statusprick i profillistan, hint vid Permission denied i
   terminalen, installation via öppen terminalsession (ControlMaster), Windows-hosts.

### P3 — Polering och plattformskänsla

- [x] **25. Riktig inställningsskärm** bakom kugghjulet i `TabBar`. Stöd för tema (mörkt, ljust, system med live respons), typsnitt/storlek för terminalen med interaktiv förhandsgranskning samt standardbeteende för nya flikar vid appstart. Sparas persistent via `SettingsStore`.
- [x] **26. Ljust tema / systemtema-följning.** Integrerat via inställningsskärmen med dynamisk CSS `.light`-klass och synkroniserat xterm-färgtema.
- [x] **27. Anpassningsbara tangentbordsgenvägar.** Ny flik i `SettingsModal` för interaktiv inspelning av snabbkommandon (globala tangentbordslyssnare i `App.tsx` för flikhantering, inställningar, profiler och terminalsplit) samt återställningsfunktion.
- [x] **28. Appikon + `desktopName`** för Linux. Genererade PNG-ikoner i alla standardstorlekar (16x16 till 512x512) i `build/icons/`, `desktopName: sshs3` i `electron-builder.json` samt fönsterikon konfigurerad i `src/main/index.ts`.
- [x] **29. Automatiska uppdateringar** — `electron-updater` mot GitHub Releases
   (`src/main/update/UpdateService.ts`). Kollar 30 s efter start och var 6:e timme
   (av/på under Inställningar → App Behavior), bannern `UpdateBanner` ber om klick för
   nedladdning och omstart; inget laddas ned eller installeras tyst. AppImage och
   deb/rpm stöds (deb/rpm ber om pkexec/sudo). **Windows är avstängt** (`windows-unsigned`)
   tills bygget är signerat; där, i dev och med `SSHS3_DISABLE_UPDATES=1` (air-gap,
   låser inställningen och gör ingen nätverkstrafik) visas bara "ladda ned manuellt".
   **Kvar:** Windows-signering och sedan slå på updatern där: SignPath Foundation
   (villkor kartlagda: code signing policy på hemsidan, integritetstext, MFA, bygget
   delas upp så sha512 i `latest.yml` räknas om efter signering) eller Azure Trusted
   Signing; sätt `win.publisherName`.
- [ ] **30. Bandbreddsbegränsning** för överföringar.
- [ ] **31. Arkivstöd** (packa upp/zippa filer på fjärrsystemet utan att ladda ner
   dem först).
- [ ] **61. S3 Bucket Analytics — visuell storleks- och kostnadsanalys.** AWS egen
   konsol är notoriskt svårnavigerad för att snabbt se var pengarna går. Bygg vidare på
   #43 (rekursiv katalogstorlek) och #46 (versionshantering, redan klart) med en enkel
   "Bucket Analytics"-flik: enkla diagram över vilka mappar som tar mest plats, samt hur
   stor andel av utrymmet (och kostnaden) som äts upp av gamla, dolda objektversioner
   som ligger kvar i tysthet.
- [ ] **62. Djup integrering med lokala miljöer (Docker/WSL/Colima)** — hantera en
   lokal Docker-container eller WSL2-distro på samma sätt som en fjärr-SSH-server, genom
   att prata med Docker-socketen/WSL istället för SSH. Stort scope (ny lagrings-/
   anslutningstyp, inte bara en variant av SSH/SFTP/S3) — men gör appen till ett
   komplett allt-i-ett-verktyg för utvecklare som kör mycket lokalt.
- [x] **32. Presigned URLs för S3-objekt** (dela en fil utan att ladda ner/upp den
   via klienten). `getPresignedUrl` i `S3StorageProvider` (via `@aws-sdk/s3-request-presigner`,
   klampad till SigV4:s 7-dagarsgräns), nås via "Generate Web URL(s)..." i S3-kontextmenyn
   (`PresignedUrlModal` med expiry-val, per-länk- och "Copy All"-knappar).
- [x] **56. "Download to..." — nedladdning till valfri lokal mapp utan att öppna en andra panel.**
   Kontextmenyalternativ i `FilePane` för SFTP/S3 som öppnar en native mapp-väljare
   (`dialog:open-folder`) och kör markeringen genom befintlig överföringskö/konfliktflöde,
   istället för att kräva drag-and-drop mellan två redan öppna paneler.
- [ ] **33. Multifönsterstöd** (öppna en andra appinstans/fönster).
- [ ] **49. Terminal-bell och aktivitetsindikator** — stöd för ASCII Bell (auditiv signal, visuell blixt eller flikindikering när output genereras i en bakgrundsflik).
- [ ] **50. Automatisk synkronisering vid filändring ("Keep remote directory up to date")** — övervaka en lokal katalog med filsystem-watcher och ladda automatiskt upp ändrade filer till SFTP/S3 i bakgrunden (WinSCP-funktion).
- [ ] **51. Anpassade fjärrkommandon (Custom commands)** — köra fördefinierade skalskript/kommandon (t.ex. `tar -xzf`, `tail -n 100`, `grep`, `md5sum`) direkt på markerade filer via SFTP/SSH.
- [ ] **52. S3 Livscykelregler (Lifecycle rules)** — konfigurera automatiska övergångar mellan lagringsklasser (t.ex. Standard -> IA -> Glacier) eller automatisk radering av gamla objektversioner efter *N* dagar.
- [x] **53. S3 Taggning (Tagging)** — `getTags`/`setTags` i `S3StorageProvider` (bucket- och objekt-taggning) samt `TagsModal` i filhanteraren för att hantera nyckel-värdetaggar via kontextmenyn.
- [ ] **54. S3 Statisk webbhotellskonfiguration (Static website hosting)** — konfigurera index- och feldokument samt hämta webbendpoint för buckets.
- [ ] **55. S3 Multipart- och prestandainställningar** — finjustera delstorlek (part size) och antal samtidiga strömmar vid upp-/nedladdning av stora objekt.
- [x] **65. Skrivbords- och Windows-ergonomi i filhanteraren (Drag & Drop, Urklipp & Tangentbordsstyrning)** —
   Auto-scroll vid Drag & Drop nära över- och underkant (`requestAnimationFrame`), neutral droppyta i
   botten av listan för att tryggt kunna släppa filer i aktuell katalog även när fönstret är fullt av
   undermappar, brödsmulor (breadcrumbs) som aktiva droppmål (släpp på roten `/` eller valfri överordnad mapp),
   spring-loaded folders (hover-to-open vid drag efter 900ms på mappar och breadcrumb-segment),
   fullständigt urklippsstöd för filer (`Ctrl+C` / `Ctrl+X` med visuell nedtoning / `Ctrl+V` både via kortkommandon
   och kontextmenyer), framåt-/bakåt-kataloghistorik med toolbar-knappar, `Alt+Vänster`/`Höger` och musknappar (3 & 4),
   tangentbordsreflexer (`F2` för Rename, `F5` för Refresh, `Alt + Uppil` för föräldrakatalog) samt avbryt
   pågående drag med `Escape`.
- [x] **66. K8s Pod File Explorer** — integrerad filhantering mot körande Kubernetes/OpenShift-containrar via `K8sPodStorageProvider`. Utvecklare och administratörer kan bläddra i containerfilsystem, redigera konfigurations- och miljöfiler direkt i `FileEditorModal` och externa editorer med autosparning tillbaka till podden, ladda upp/ner filer via drag & drop samt starta interaktiv terminal i aktuell containerkatalog via "Open in Terminal".
- [x] **67. K8s Live Pod Debugging (`kubectl debug`)** — koppla på temporära felsökningscontainrar (ephemeral containers) i körande poddar utan omstart via `K8sDebugService` (`/ephemeralcontainers`). Stöd för process/PID-delning (`targetContainerName`), fördefinierade felsökningsimages (Netshoot, RHEL Support Tools, BusyBox, Curl, Ubuntu) samt konfigurerbara custom images under Inställningar -> Kubernetes & Debug. Startar automatiskt interaktiv terminal session i felsökningscontainern.
- [ ] **68. Statusindikator på terminalflikar** — färgmarkera flikar efter terminalens tillstånd: ansluter/återansluter (gul), strömmar data (blå), idle/prompt-redo (grön), avslutad ok (grå), avslutad med fel (röd), program väntar på input (t.ex. `[y/N]`, `password:`; gul/orange). Bakgrundsflikar kan pulsera vid ny utdata eller när de börjar vänta på input.
   - **Underlag finns:** `onTerminalData`/`onK8sTerminalData` och `term.onData` i `TerminalView`, `onExit` med `exitCode`, samt `reconnecting`/`reconnected` från `SSHPtyManager`. `TabBar` ritar redan indikatorer (tunnelstatus).
   - **"Väntar på input"** är det svåra (PTY vet inte om skalet är på prompten). Steg 1: tystnadsheuristik (1–2 s) + mönster på sista raden. Steg 2 (valfritt): shell-integration via OSC 133 för exakt prompt/kommando-status, kräver snutt i fjärrskalets rc-fil.
   - **Genomförande:** ren statusmaskin i utility-fil (data/exit/reconnect → status, med timers), `TerminalView` rapporterar uppåt via callback likt `onExit`, prick/kant i `TabBar`. Inställning för av/på, färgblindsäkert (ikon/form utöver färg), enhetstester för statusmaskinen.
   - **Öppna frågor:** ska grönt betyda prompt-redo eller ska "program frågar" ha egen färg? Prick eller färgad kant på hela fliken?
- [ ] **69. Företagsprofilering (corporate branding: accentfärg, logotyp, miljömarkering)** — låt företag/användare ge appen sin egen accentfärg och logotyp, samt färgmarkera miljöer (prod/stage/dev) per profil. Börja i plan mode; delar berör säkerhetskänsliga områden (IPC, sync, CSP).
   - **Underlag finns:** all färg går via CSS-variabler i `index.css` (`--accent-primary`, `--bg-*`; teman `dark`/`light`/`breeze`, `AppTheme` i `shared/types/settings.ts`). `BrandLogo.tsx` är en hårdkodad inline-SVG. Branding läggs som override ovanpå temana, inga komponenter behöver skrivas om.
   - **Steg 1 — Tema (accent + logotyp):** `branding?: { accent?: string; logoDataUrl?: string; appName?: string }` i `AppSettings`, ny `BrandingStore` (med `queueMutation`) och IPC enligt `ARCHITECTURE.md` §4. Sätt `--accent-primary` från `branding.accent`; härled `--accent-hover`/`--accent-subtle` med `color-mix()`. Bakgrunder och text lämnas orörda. Kontrastvarning (WCAG) mot `--bg-app` i inställningarna.
   - **Steg 2 — Var det syns:** `BrandLogo` byts mot `<img>` när egen logotyp finns (sshs3-märket som fallback) i titelrad/sidopanel, Om-dialog och startskärm. Valfri färg/ikon per profil som miljömarkering i `TabBar` och profillista, plus färgad kant eller svag vattenstämpel på terminalen (syns vid skärmdelning, minskar risken att skriva i fel miljö).
   - **Steg 3 — Distribution:** signerad `branding.json` + logotyp via den krypterade profilsynken (`SyncCryptoService`) och/eller managed config (`/etc/sshs3/branding.json`, `%PROGRAMDATA%`) för MDM/image-utrullning. `branding.locked: true` döljer ändringsmöjligheten i inställningarna.
   - **Säkerhet (granska efteråt):** logotyp endast PNG/JPEG/WebP (SVG bara efter sanering, annars XSS), max ~256 KB, validerad i main, lagrad som data-URL, aldrig extern URL (CSP, IP-läckage). IPC-handlers validerar argument. Säkerhetsdialoger (host key/TOFU, PIN) behåller neutral styling så branding inte kan användas för spoofing. Branding från synk/admin-fil måste vara signerad eller krypterad, inte skrivbar av vem som helst.
   - **Öppna frågor:** global inställning per installation eller branding per organisation/synkprofil? Ska managed config kunna låsa och åsidosätta användarens val?
   - **Tester:** enhetstester för färgvalidering/kontrast, logotypvalidering (MIME, storlek, SVG-avvisning) och `BrandingStore`.

- [ ] **70. En app-agent för PIN-cachelägget Global (FIDO2 + PIV i samma ssh-agent)** — idag laddas varje enhet i en egen privat agent (`__fido2__` och ett PKCS#11-bibliotek per agent i `IpcBridge.globalSmartcardAgents`), och en lokal terminal får bara den första (`IpcBridge.ts` ~rad 519). Samma YubiKey kan dessutom laddas två gånger (p11-kit-proxy + libykcs11). Mål: i Global-läget ligger allt upplåst i **en** privat app-agent med stabil socket som lokala terminaler och appens SSH/SFTP använder. *Always Prompt* och *Once Per Terminal Connection* behåller sina privata agenter. Börja i plan mode; berör askpass/PIN och `child_process` (säkerhetsgranska efteråt).
   - **Beslut (2026-10-05):** (1) lokal terminal i Global-läget pekar alltid på app-agenten, även tom (senare upplåsning fungerar, systemagenten tappas i den terminalen; *System Only* är utvägen); (2) stabil socket i `$XDG_RUNTIME_DIR/sshs3/agent.sock` (Linux) / motsvarande under appens datakatalog (macOS), katalog 0700; (3) config-blocket (steg 7) görs som uppföljning efter steg 1–6.
   - **Steg 1 — `AppAgent`** *(klart 2026-10-05, ännu inte kopplat till `IpcBridge`)* (`src/main/ssh/AppAgent.ts`): `ssh-agent -D -a <socket>` med en askpass-server som lever lika länge som agenten (miljön bakas in vid start, som `keepAskpassAliveForAgentLifetime` idag). API: `ensure()`, `socketPath`, `list()`, `addPkcs11()`, `addFido2Resident()`, `remove(lib)`, `lockAll()` (`ssh-add -D`), `shutdown()`. Registreras i `AgentRegistry` (`cleanupOrphanedResources` städar efter krasch). Windows: den delade tjänst-pipen som idag (`pid: 0`).
   - **Steg 2 — dela upp laddaren** *(klart 2026-10-05: `addSmartcardToAgent`/`addFido2ResidentKeysToAgent` + `AppAgent.addPkcs11/addFido2Resident`; framgång mäts mot agentens identiteter före/efter, inte bara "listan är icke-tom"; varje laddning promptar via en egen askpass-server i `ssh-add`s miljö och rör aldrig agentens askpass-server, så en FIDO2-signatur-prompt (`verify-required`) mitt i en laddning aldrig kan få laddningens PIN; startupupplåsningen laddar PIV före FIDO2 som extra säkerhetsmarginal)* (`SmartcardAgentLoader.ts`): "spawna agent" skiljs från "lägg till i agent" (`addToAgent(socketPath, args, handlers)`); befintliga `loadSmartcardIntoPrivateAgent`/`loadFido2ResidentKeysIntoPrivateAgent` behåller signaturerna för per-session-lägena.
   - **Steg 3 — `IpcBridge`** *(klart 2026-10-05: Global-läget kör en `AppAgent`; `globalCards` håller fingeravtryck per kort; nyckelval i appens egna ssh-anrop via `agentIdentityFiles` → `IdentitiesOnly` + `-i <pub>`; sync-länkning/upplåsning väljer rätt korts nyckel; kvarstår: Windows-nyckelval, steg 4, 5, 7)*: `globalSmartcardAgents` ersätts av `globalCards` (status, cooldown, certifikat per bibliotek/FIDO2) + en `AppAgent`. `getOrLoadGlobalSmartcardAgent`/`getOrLoadGlobalFido2Agent` behåller dedupe av pågående laddningar och 30 s-cooldown men returnerar app-agentens socket. Uppdatera ~rad 519 (lokal terminal), ~1691 (SFTP), ~2107–2127 (startupupplåsning) och lås (~2241: `lockAll()` i stället för att döda processer).
   - **Steg 4 — avduplicering** *(klart 2026-10-05: ett bibliotek vars nycklar redan finns i agenten laddas inte igen och ger ingen ny PIN-fråga)*: jämför certifikatens fingeravtryck (`readSmartcardCertificates`) med agentens identiteter före laddning; hoppa över ett bibliotek vars nycklar redan finns (föredra p11-kit). Laddningar seriella via befintliga `pkcs11-lock` (en transaktion åt gången; Net iD kraschade vid samtidig åtkomst).
   - **Steg 5 — certifikatinfo (bevaras)** *(UI-texterna i Settings uppdaterade 2026-10-05)*: `globalSmartcardCerts` (bibliotek → fingeravtryck → cert) finns kvar. `listGlobalSmartcardAgents` läser `ssh-add -l` från den enda agenten och grupperar identiteter per bibliotek genom att slå upp fingeravtrycket i varje biblioteks certifikatkarta (`sk-*`-nycklar → FIDO2). Samma nyckel i två bibliotek tillskrivs det som laddades först.
   - **Steg 6 — touch (oförändrat vid laddning):** `execWithPresenceDetection` (text från `ssh-add`) fungerar som idag. Touch vid *signering* (FIDO2 `verify-required`) går via agentens askpass-server → `onPresence`. Ändring: den servern lever nu med appen i stället för med en enskild session, så banderollen kan inte kopplas till vilken terminal som signerar utan visas globalt ("Touch your security key"), som toasten redan gör i dag. PIV med touch-policy på själva nyckeln ger ingen text och upptäcks inte idag heller.
   - **Steg 7 — config-blocket** *(klart 2026-10-05, annan utformning än skissen: ett andra, lokalt block `sshs3-agent` före managed-blocket som åsidosätter identitetsraderna per värd medan kortet är upplåst; synkas aldrig, ingen ändring i sanitizern, `IdentityAgent` förblir spärrat för fjärrinnehåll; borttaget vid lås/avslut/Global av och städas vid start)*. Ursprunglig skiss: för smartcard/FIDO2-profiler skriv `IdentityFile <publik nyckel>` + `IdentitiesOnly yes` (undviker "Too many authentication failures" med många nycklar i en agent) och `IdentityAgent <stabil socket>` i stället för `PKCS11Provider` (som alltid ger PIN-fråga i `ssh` själv). Kräver att lokal generering skiljs från inkommande synk i sanitizern (`identityagent` är spärrat i `BLOCKED_SSH_DIRECTIVES`) och att appen skriver ut publik nyckelfil. Konsekvens: `ssh <alias>` utan app/upplåst kort faller tillbaka på lösenord.
   - **Tester:** enhetstester för `AppAgent` (mockad `execFile`), integrationstest mot riktig `ssh-agent` (hoppas över om binären saknas), migrera tester som rör `globalSmartcardAgents`, manuell verifiering med `run-desktop`. Uppdatera README (agentavsnitten) och användarguiden.
   - **Känt (observerat 2026-10-05):** en ssh-agent hanterar förfrågningar en i taget, så en FIDO2-signatur som väntar på PIN/touch blockerar *alla* andra förfrågningar mot app-agenten (t.ex. Remote Profile Sync-auto-upplåsning med PIV-nyckeln fick "Timed out communicating with ssh-agent"). Följd av en delad agent; åtgärd vore att serialisera appens egna agentanrop mot touch-väntande signaturer eller behålla separata agenter för FIDO2.
   - **Risker:** många nycklar i en agent → server räknar fel (MaxAuthTries 6) tills steg 7; terminalen tappar systemets agent i Global-läget; askpass måste fungera för `verify-required`-nycklar i den delade agenten; PIN får aldrig loggas (loggar visar bara antal tecken).

## Funktionsanalys: PuTTY, WinSCP & S3 Browser

Sammanställning av vad respektive referensverktyg har som sshs3 saknar idag, och var i roadmapen det adresseras:

### PuTTY (Terminal & Anslutning)
- **Stöd för `.ppk`-nycklar**: PuTTYs eget nyckelformat (v2 & v3) stöds inte direkt i OpenSSH utan konvertering via `puttygen` -> **#34**
- **Kopiera-vid-markering (Copy-on-select) & klistra in med högerklick**: Kärnbeteende i PuTTY -> **#39** ✅
- **Sökning i terminalbuffert & scrollback**: Sök i historik samt rensa skärm/buffert -> **#40** (scrollback rader ✅, sökning i buffert återstår)
- **SSH Agent Forwarding (`-A`) & Pageant**: Vidarebefordran av lokal agent till fjärrsessioner -> **#41** ✅
- **Terminal Bell & aktivitetsnotifiering**: Visuell/auditiv bell och flikindikator vid bakgrundsaktivitet -> **#49**
- **Sessionsdelning / Multiplexing**: Snabbare anslutningar via återanvänd TCP-anslutning (OpenSSH `ControlMaster`) -> relaterat till **#11, #20**
- *(Seriell anslutning/COM-port: Finns i PuTTY men lägre prioritet för en ren SSH/S3-klient)*

### WinSCP (SFTP & Filhantering)
- **Redigera fjärrfiler direkt / intern editor**: Öppna i lokal editor eller inbyggd snabbviewer -> **#4, #37** ✅
- **Öppna terminal i aktuell katalog**: Starta SSH-flik direkt i samma sökväg som SFTP-panelen -> **#35** ✅
- **Bokmärken / Favoritsökvägar**: Spara kataloger för snabbnavigering -> **#36**
- **Synkroniserad bläddring**: Speglad mappnavigering i dubbelpanelen -> **#42**
- **Kalkylera katalogstorlek**: Rekursiv storleksberäkning (`du`) -> **#43**
- **Bevara tidsstämplar (mtime)**: Behåll originaldatum vid överföring -> **#44** ✅
- **Filmasker / exkluderingsfilter**: Uteslut t.ex. `.git/` eller `node_modules/` vid synk/kopiering -> **#45**
- **Katalogövervakning ("Keep remote directory up to date")**: Auto-upload vid lokala filändringar -> **#50**
- **Anpassade kommandon**: Kör kommandon (`tar`, `tail`, etc.) på markerade filer via SSH -> **#51**
- **Katalogsynkronisering (Diff & Sync)**: Jämför kataloger och spegla -> **#7** ✅
- **Kör skript direkt på fjärrservern från filhanteraren**: Högerklick på `.sh`/`.py` -> kör i tillhörande SSH-flik -> **#59**
- **Visuell diff/status för Git-repon på fjärrservern**: Ändrings-/konfliktikoner i filträdet -> **#60**
- **Streama/visa enorma loggfiler utan att ladda hela filen**: Lazy loading eller `tail -f` -> **#58** ✅

### S3 Browser (Objektlagring & S3-hantering)
- **Bucket-livscykel: Skapa, radera & tömma**: Skapa nya buckets och tömma icke-tomma buckets rekursivt -> **#38**
- **Versionshantering**: Visa dolda/raderade versioner, raderingsmarkörer och återställning -> **#46** ✅
- **Metadata & HTTP-headers**: Redigera `Content-Type`, `Cache-Control`, `x-amz-meta-*` -> **#47**
- **Bucket Policies & CORS**: Inspektera och redigera JSON-policies och CORS-regler -> **#48** ✅
- **Lagringsklass & Server-side kryptering (inkl. valbar KMS-nyckel) vid upload**: Välj SSE-S3/SSE-KMS och Standard/IA/Glacier -> **#22** (kryptering ✅, lagringsklass återstår)
- **Presigned URLs**: Generera tidsbegränsade delningslänkar -> **#32** ✅
- **"Download/Copy/Move all files to.."**: Massöverföring till valfri mapp direkt från kontextmenyn -> **#56** ✅ (download), kopiera/flytta mellan godtyckliga mål återstår
- **IAM/SSO-inloggning i stället för statiska nycklar**: `aws sso login`-flöde och lokal AWS-profilläsning -> **#57** ✅
- **Livscykelregler (Lifecycle)**: Automatisera övergång till IA/Glacier eller utgångsdatum -> **#52**
- **Tagghantering**: Sätta taggar på buckets och objekt -> **#53** ✅
- **Statisk webbhotellshosting**: Konfigurera S3 website hosting -> **#54**
- **Multipart tuning**: Justera chunk-storlek och samtidighet -> **#55**
- **Kostnads-/storleksanalys per bucket**: Visuell översikt över vad som tar plats -> **#61**

## Föreslagen ordning att ta itu med det i

Då **1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 17, 18, 19, 20, 24, 25, 26, 27, 28, 32, 35, 37, 39, 41, 44, 46, 48, 53, 56, 57, 58, 63, 64, 65, 66, 67** redan är färdigställda (samt krypteringshalvan av **22**), är de mest värdefulla nästa stegen:

1. **16. Broadcast / multi-exec** — funktionen som motiverar "multi" i namnet och lyfter terminalupplevelsen över standardverktyg.
2. **36. Bokmärken / Favoritsökvägar i filhanteraren** — snabbåtkomstmeny i `FilePane` för snabbhopp på lokal disk, SFTP och S3.
3. **34. Stöd för PuTTY-nycklar (.ppk)** — undanröjer ett av de vanligaste hindren för Windows- och PuTTY-användare som byter till sshs3.
4. **38. S3 Bucket-administration (Skapa, radera & purge)** — hantera hela livscykeln för buckets direkt i UI:t.
5. **40. Sökning i terminalbuffert (`Ctrl+Shift+F`)** — sökning i aktiv terminalhistorik med highlight och navigering.
6. ~~**29. Automatiska uppdateringar**~~ — klart; kvar är Windows-signering.
