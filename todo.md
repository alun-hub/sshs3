# sshs3 — Roadmap / TODO

Status som av 2026-09-16 19:05. Bygger på en genomgång av koden i `src/`, inte bara planen i
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
- **Ingen automatisk uppdateringsmekanism** — paketen är i dagsläget manuella
  engångsbyggen.

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
- [x] **8. Permissions-editor (chmod)** för SFTP och lokal lagring. Rättighetskolumn visas i listan med sortering, och en interaktiv chmod-modal (User/Group/Other kryssrutor, oktal representation och rekursivt val) kan öppnas via knapp i verktygsraden.
- [x] **9. Standardkatalog/startsökväg per profil.** Stöd för `initialPath` i SSH-, SFTP- och S3-profiler med fält i profilformulären och direkt navigering vid anslutning i filhanteraren.
- [x] **10. Utgående proxy (HTTP / SOCKS4 / SOCKS5)** för att nå servrar bakom företagsbrandväggar. Stöd för SSH (OpenSSH `ProxyCommand` med `proxyCli.cjs` för autentisering), SFTP (tunneling via `createProxySocket` i `SFTPStorageProvider`) och S3 (`NodeHttpHandler` med proxy-agenter). Profilformulären har expanderbar proxysektion och proxylösenord krypteras säkert via `safeStorage`.
- [ ] **11. Anslutningstimeout, återförsök och automatisk återanslutning** vid
   nätverkstapp — idag finns bara paus/återuppta för överföringar, inget för
   själva sessionen.
- [ ] **12. Import/export av anslutningsprofiler** (t.ex. från `~/.ssh/config`,
   PuTTY, eller en enkel JSON-export) så man slipper mata in allt manuellt.
- [x] **13. Testa anslutning-knapp.** Implementerad i `SSHProfileForm` och `S3ProfileForm` via backend-anrop (`connection:test-ssh` och `connection:test-s3`) med visuell statusindikator och felrapportering innan profilen sparas.
- [x] **14. Sessions-/flikpersistens.** Öppna terminal- och filflikar samt senast besökta katalogsökvägar sparas och återställs automatiskt mellan omstarter via `SessionStore` (`session.json`).
- [ ] **15. Checksumverifiering efter överföring** (t.ex. jämför storlek/hash) för
   att upptäcka trunkerade/korrupta filer.
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
- [ ] **37. Inbyggd snabbviewer/editor för textfiler** — snabbgranska loggfiler eller
   redigera konfigurationer direkt inuti appen (med syntax-highlighting) utan att
   behöva installera eller koppla extern editor.
- [ ] **38. S3 Bucket-administration: Skapa, radera och tömma bucket (Purge)** —
   hantera hela livscykeln för buckets direkt i UI:t, inklusive regionval vid skapande
   och rekursiv tömning av objekt och versioner inför radering.

### P2 — Det som gör en "Multi"-SSH-klient, inte bara "en SSH-klient" (och vanliga finjusteringar)

- [ ] **16. Broadcast/multi-exec: skicka samma tangenttryckningar till flera
   terminalflikar samtidigt.** Detta är den mest uppenbara luckan givet
   produktnamnet — funktionen finns i ClusterSSH, MobaXterm och Termius, men
   inte här. Naturlig utökning av befintlig `TabBar`/`TerminalView`.
- [x] **17. Delad/grupperad vy** (flera terminaler sida vid sida i en flik, t.ex. 2 kolumner, 2 rader och 2x2-grid). Integrerat i `App.tsx` med verktygsfält för layoutbyte, oberoende terminalpaneler med anslutningsväljare och full sessionspersistens.
- [x] **18. SSH-porttunnling** (lokal `-L`, fjärr `-R` och dynamisk SOCKS-proxy `-D`). Konfigureras per profil i `SSHProfileForm`, skickas säkert till OpenSSH i `SmartcardDetector.buildSSHArguments()` och sparas persistent.
- [x] **19. Jump host / ProxyJump-stöd i UI:t.** Stöd i `SSHProfileForm` och `SmartcardDetector` (`-J`), samt fullt stöd för SFTP via stream-forwarding (`ssh2.forwardOut`) i `SFTPStorageProvider`.
- [x] **20. SSH-anslutningsalternativ i formuläret**: kompression (`Compression`), keep-alive (`ServerAliveInterval`), samt valbara ciphers, KEX och MAC-algoritmer för både terminal och SFTP-anslutningar.
- [ ] **21. Teckenkodning/charset-inställning** för filnamn — relevant mot äldre
   SFTP-servrar som inte pratar UTF-8.
- [ ] **22. S3-uppladdningsalternativ**: lagringsklass (Standard/IA/Glacier) och
   server-side encryption (SSE-S3/SSE-KMS) — `PutObjectCommand` i
   `S3StorageProvider` sätter inget av detta idag.
- [ ] **23. Sessionsloggning** — spara terminalens output till fil, användbart för
   felsökning och revision.
- [x] **24. Profilorganisation i mappar/grupper** samt "senast använda"-lista i
   `ConnectionManagerModal` med tidsstämplar (`yyyy-mm-dd HH:mm`), expanderbara/kollapsbara mappgrupper med profilräknare och integrerad direkt-anslutning.
- [ ] **39. PuTTY Terminal-UX: Kopiera-vid-markering (Copy on select) & klistra in med högerklick/mittenklick** — standardarbetsflöde i PuTTY; gör det blixtsnabbt att kopiera text utan Ctrl+Shift+C och klistra in med musklick, valbart via Inställningar.
- [ ] **40. Sökning i terminalbuffert & scrollback-hantering** — sökfunktion (Ctrl+Shift+F med matchningsmarkering och navigering upp/ned i historiken) samt möjlighet att rensa buffert och sätta valfri buffertstorlek (rader).
- [ ] **41. SSH Agent Forwarding (`-A`)** — vidarebefordra lokal SSH-agent/Pageant till fjärrsessioner så man kan hoppa vidare utan att kopiera privata nycklar till servern.
- [ ] **42. Synkroniserad bläddring (Synchronized browsing)** — WinSCP-funktion: vid navigering i undermappar i vänster panel följer höger panel automatiskt med till samma mappnamn om det existerar.
- [ ] **43. Beräkna katalogstorlek (Recursive size / `du`)** — visa sammanlagd storlek och antal filer för markerade mappar i SFTP och S3 via kontextmenyn.
- [ ] **44. Bevara tidsstämplar (mtime) vid filöverföring** — val att behålla filers ursprungliga ändringstidsstämplar vid upp-/nedladdning mellan lokal disk och SFTP.
- [ ] **45. Filmasker och exkluderingsfilter vid överföring** — uteslut mönster som `node_modules/`, `.git/`, `*.tmp`, `.DS_Store` vid överföring av mappar och synkning.
- [x] **46. S3 Versionshantering (Versioning)** — `S3StorageProvider` stöder `listObjectVersions`/`deleteObjectVersion`/`restoreObjectVersion` samt `getBucketVersioning`/`setBucketVersioning`. `VersionsModal` i filhanteraren visar tidigare versioner och raderingsmarkörer med återställning/permanent radering för objekt, och aktivera/pausa-knapp för bucket-nivå.
- [ ] **47. S3 Metadata & HTTP-headers editor** — granska och redigera `Content-Type`, `Cache-Control`, `Content-Disposition` och anpassade användarmetadata (`x-amz-meta-*`) för valda objekt.
- [x] **48. S3 Bucket Policy & CORS-redigerare** — `BucketPolicyModal` med flikar för JSON-policy och CORS-regler, backat av `getBucketPolicy`/`setBucketPolicy`/`getBucketCors`/`setBucketCors` i `S3StorageProvider`, nås via bucket-kontextmenyn.

### P3 — Polering och plattformskänsla

- [x] **25. Riktig inställningsskärm** bakom kugghjulet i `TabBar`. Stöd för tema (mörkt, ljust, system med live respons), typsnitt/storlek för terminalen med interaktiv förhandsgranskning samt standardbeteende för nya flikar vid appstart. Sparas persistent via `SettingsStore`.
- [x] **26. Ljust tema / systemtema-följning.** Integrerat via inställningsskärmen med dynamisk CSS `.light`-klass och synkroniserat xterm-färgtema.
- [x] **27. Anpassningsbara tangentbordsgenvägar.** Ny flik i `SettingsModal` för interaktiv inspelning av snabbkommandon (globala tangentbordslyssnare i `App.tsx` för flikhantering, inställningar, profiler och terminalsplit) samt återställningsfunktion.
- [x] **28. Appikon + `desktopName`** för Linux. Genererade PNG-ikoner i alla standardstorlekar (16x16 till 512x512) i `build/icons/`, `desktopName: sshs3` i `electron-builder.json` samt fönsterikon konfigurerad i `src/main/index.ts`.
- [ ] **29. Automatiska uppdateringar** (`electron-updater` eller motsvarande) —
   ingen uppdateringsmekanism finns alls just nu; paketen i Task 11 är
   engångsbyggen.
- [ ] **30. Bandbreddsbegränsning** för överföringar.
- [ ] **31. Arkivstöd** (packa upp/zippa filer på fjärrsystemet utan att ladda ner
   dem först).
- [ ] **32. Presigned URLs för S3-objekt** (dela en fil utan att ladda ner/upp den
   via klienten).
- [ ] **33. Multifönsterstöd** (öppna en andra appinstans/fönster).
- [ ] **49. Terminal-bell och aktivitetsindikator** — stöd för ASCII Bell (auditiv signal, visuell blixt eller flikindikering när output genereras i en bakgrundsflik).
- [ ] **50. Automatisk synkronisering vid filändring ("Keep remote directory up to date")** — övervaka en lokal katalog med filsystem-watcher och ladda automatiskt upp ändrade filer till SFTP/S3 i bakgrunden (WinSCP-funktion).
- [ ] **51. Anpassade fjärrkommandon (Custom commands)** — köra fördefinierade skalskript/kommandon (t.ex. `tar -xzf`, `tail -n 100`, `grep`, `md5sum`) direkt på markerade filer via SFTP/SSH.
- [ ] **52. S3 Livscykelregler (Lifecycle rules)** — konfigurera automatiska övergångar mellan lagringsklasser (t.ex. Standard -> IA -> Glacier) eller automatisk radering av gamla objektversioner efter *N* dagar.
- [x] **53. S3 Taggning (Tagging)** — `getTags`/`setTags` i `S3StorageProvider` (bucket- och objekt-taggning) samt `TagsModal` i filhanteraren för att hantera nyckel-värdetaggar via kontextmenyn.
- [ ] **54. S3 Statisk webbhotellskonfiguration (Static website hosting)** — konfigurera index- och feldokument samt hämta webbendpoint för buckets.
- [ ] **55. S3 Multipart- och prestandainställningar** — finjustera delstorlek (part size) och antal samtidiga strömmar vid upp-/nedladdning av stora objekt.

## Funktionsanalys: PuTTY, WinSCP & S3 Browser

Sammanställning av vad respektive referensverktyg har som sshs3 saknar idag, och var i roadmapen det adresseras:

### PuTTY (Terminal & Anslutning)
- **Stöd för `.ppk`-nycklar**: PuTTYs eget nyckelformat (v2 & v3) stöds inte direkt i OpenSSH utan konvertering via `puttygen` -> **#34**
- **Kopiera-vid-markering (Copy-on-select) & klistra in med högerklick**: Kärnbeteende i PuTTY -> **#39**
- **Sökning i terminalbuffert & scrollback**: Sök i historik samt rensa skärm/buffert -> **#40**
- **SSH Agent Forwarding (`-A`) & Pageant**: Vidarebefordran av lokal agent till fjärrsessioner -> **#41**
- **Terminal Bell & aktivitetsnotifiering**: Visuell/auditiv bell och flikindikator vid bakgrundsaktivitet -> **#49**
- **Sessionsdelning / Multiplexing**: Snabbare anslutningar via återanvänd TCP-anslutning (OpenSSH `ControlMaster`) -> relaterat till **#11, #20**
- *(Seriell anslutning/COM-port: Finns i PuTTY men lägre prioritet för en ren SSH/S3-klient)*

### WinSCP (SFTP & Filhantering)
- **Redigera fjärrfiler direkt / intern editor**: Öppna i lokal editor eller inbyggd snabbviewer -> **#4, #37**
- **Öppna terminal i aktuell katalog**: Starta SSH-flik direkt i samma sökväg som SFTP-panelen -> **#35**
- **Bokmärken / Favoritsökvägar**: Spara kataloger för snabbnavigering -> **#36**
- **Synkroniserad bläddring**: Speglad mappnavigering i dubbelpanelen -> **#42**
- **Kalkylera katalogstorlek**: Rekursiv storleksberäkning (`du`) -> **#43**
- **Bevara tidsstämplar (mtime)**: Behåll originaldatum vid överföring -> **#44**
- **Filmasker / exkluderingsfilter**: Uteslut t.ex. `.git/` eller `node_modules/` vid synk/kopiering -> **#45**
- **Katalogövervakning ("Keep remote directory up to date")**: Auto-upload vid lokala filändringar -> **#50**
- **Anpassade kommandon**: Kör kommandon (`tar`, `tail`, etc.) på markerade filer via SSH -> **#51**
- **Katalogsynkronisering (Diff & Sync)**: Jämför kataloger och spegla -> **#7**

### S3 Browser (Objektlagring & S3-hantering)
- **Bucket-livscykel: Skapa, radera & tömma**: Skapa nya buckets och tömma icke-tomma buckets rekursivt -> **#38**
- **Versionshantering**: Visa dolda/raderade versioner, raderingsmarkörer och återställning -> **#46**
- **Metadata & HTTP-headers**: Redigera `Content-Type`, `Cache-Control`, `x-amz-meta-*` -> **#47**
- **Bucket Policies & CORS**: Inspektera och redigera JSON-policies och CORS-regler -> **#48**
- **Lagringsklass & Server-side kryptering vid upload**: Välj SSE-S3/KMS och Standard/IA/Glacier -> **#22**
- **Presigned URLs**: Generera tidsbegränsade delningslänkar -> **#32**
- **Livscykelregler (Lifecycle)**: Automatisera övergång till IA/Glacier eller utgångsdatum -> **#52**
- **Tagghantering**: Sätta taggar på buckets och objekt -> **#53**
- **Statisk webbhotellshosting**: Konfigurera S3 website hosting -> **#54**
- **Multipart tuning**: Justera chunk-storlek och samtidighet -> **#55**

## Föreslagen ordning att ta itu med det i

Då **1, 2, 5, 8, 9, 10, 13, 14, 17, 18, 19, 20, 24, 25, 26, 27, 28, 46, 48, 53** redan är färdigställda,
är de mest värdefulla nästa stegen:

1. **4 & 37. Direktredigering & inbyggd textvisare** — låter användaren snabbt granska och ändra konfigurationer/filer på SFTP och S3 utan krångel.
2. **16. Broadcast / multi-exec** — funktionen som motiverar "multi" i namnet och lyfter terminalupplevelsen över standardverktyg.
3. **35. Öppna terminal i aktuell katalog ("Open in Terminal")** — knyter ihop SFTP-utforskaren med terminalen på ett smidigt sätt.
4. **34. Stöd för PuTTY-nycklar (.ppk)** — undanröjer ett av de vanligaste hindren för Windows- och PuTTY-användare som byter till sshs3.
5. **38 & 46. S3 Bucket-hantering & Versionshantering** — lyfter S3-stödet från en enkel filläsare till ett fullvärdigt verktyg i klass med S3 Browser.
6. **7. Katalogsynkronisering (Diff & Sync)** — den tyngsta efterfrågade funktionen från WinSCP-användare.
