# YubiKey / FIDO2 – implementationsplan

Status: draft, ej påbörjad.
Utgångsläge (verifierat i kodbasen 2026-09-25):

- YubiKey hanteras idag **enbart som PIV-smartcard via PKCS#11**
  (`src/main/smartcard/SmartcardDetector.ts` → `SmartcardAgentLoader.ts` →
  privat `ssh-agent` per profil, PIN via `AskpassServer.ts` +
  `SmartcardPinModal.tsx`).
- `SmartcardDetector`s biblioteks-lista innehåller OpenSC, Net iD och p11-kit —
  **inte** Yubicos eget `libykcs11`.
- `SSHAuthType` (`src/shared/types/ssh.ts:3`) har fyra värden:
  `'password' | 'privateKey' | 'smartcard' | 'agent'`. Inget FIDO2/`sk`-läge.
- `SFTPStorageProvider.ts` (ssh2) hanterar `smartcard`/`agent` genom att
  koppla upp mot en `SSH_AUTH_SOCK`; ssh2 självt kan inte prata PKCS#11 eller
  FIDO2 direkt, allt går via extern `ssh-agent`/`ssh-add`.
- `SmartcardSyncService.ts` låser upp synk-valvet med PKCS#11-nycklar
  (RSA/Ed25519 via kort). Inget WebAuthn/FIDO2-stöd.
- Ingen kod refererar `ed25519-sk`, `ecdsa-sk`, `ssh-keygen -K` eller `ykman`.

Detta dokument är den gemensamma planen; varje avsnitt är tänkt att bli en
egen PR i ordningen nedan (1 → 5), eftersom senare punkter bygger vidare på
mönster (askpass/agent-loader) som punkt 1–2 sätter.

---

## Prioritetsordning

| # | Uppslag | Nytta | Insats | Beroenden |
|---|---------|-------|--------|-----------|
| 1 | `libykcs11` i detektorns bibliotekslista | Hög | Låg | Inga |
| 2 | Visuell "Tryck på YubiKey"-prompt | Hög | Låg–Medel | Återanvänder AskpassServer |
| 3 | FIDO2 `ed25519-sk`/`ecdsa-sk`: generera + koppla profil | Hög | Medel–Hög | 1, 2 (touch-UX) |
| 4 | Enhetsdetektering & statusindikator (ykman/HID) | Medel | Medel | Ingen (kan gå parallellt) |
| 5 | Vault-upplåsning via WebAuthn PRF/hmac-secret | Medel | Hög | 4 (för enhetsval), separat spike |

Ordningen 1 → 2 → 3 rekommenderas eftersom touch-prompten (2) är en
förutsättning för att FIDO2-flödet (3) inte ska kännas som att appen hänger.
4 och 5 är fristående och kan skjutas på.

---

## 1. Yubicos officiella PKCS#11-modul (`libykcs11`)

**Mål:** YubiKey PIV ska fungera utan att användaren installerar OpenSC —
räcker med YubiKey Manager/PIV Tool.

**Ändringar:**
- `src/main/smartcard/SmartcardDetector.ts`: lägg till en ny grupp i
  `LINUX_LIBRARIES` / `WINDOWS_LIBRARIES`, och en ny `MACOS_LIBRARIES`-lista
  om ingen sådan finns idag (kolla — koden verkar sakna macOS-grenar helt;
  om så, lägg till som ny gren, inte bara i den befintliga listan):
  - Linux: `/usr/lib/libykcs11.so`, `/usr/lib64/libykcs11.so`,
    `/usr/lib/x86_64-linux-gnu/libykcs11.so`
  - Windows: `C:\Program Files\Yubico\Yubico PIV Tool\bin\libykcs11.dll`
  - macOS: `/usr/local/lib/libykcs11.dylib`,
    `/opt/homebrew/lib/libykcs11.dylib` (Apple Silicon Homebrew-prefix)
- Sätt prioritetsordning: p11-kit (proxar allt registrerat) → `libykcs11` →
  OpenSC → Net iD, dvs mer specifikt/officiellt för Yubico rankas före det
  generiska OpenSC-alternativet men efter p11-kit-proxyn.
- Ingen ändring behövs i `SmartcardAgentLoader.ts` — den är redan
  bibliotieks-agnostisk (tar en path).

**Test:** manuellt med en YubiKey i PIV-läge + YubiKey Manager installerat,
utan OpenSC installerat, verifiera att detektorn hittar och laddar biblioteket
och att `ssh-add -s <path>` lyckas.

**Risk:** låg. Rent tillägg till en statisk lista, ingen befintlig
kodväg påverkas.

---

## 2. Visuell "Tryck på din YubiKey"-prompt (User Presence)

**Problem:** Både PIV-touch-policy och FIDO2 kräver fysisk beröring per
operation. Idag syns bara text i PTY:n eller ingenting alls vid
SFTP/bakgrundsanslutningar → upplevs som att appen hänger.

**Ansats:** återanvänd befintlig askpass-infrastruktur men bredda den från
"vänta på PIN-textinput" till "visa ett tillstånd som inte kräver input".

**Ändringar:**
- `AskpassServer.ts`: OpenSSH anropar askpass-scriptet även för
  rena touch-bekräftelser (`Confirm user presence for key ...`), inte bara
  PIN. Lägg till en `promptKind`-klassificering (`'pin' | 'presence'`) baserat
  på prompt-textens innehåll, och emit:a den till renderern precis som idag,
  men utan att kräva textinput för `'presence'`.
- `SmartcardPinModal.tsx`: döp om/bredda till en generisk
  `SmartcardPromptModal` (eller lägg till en syskon-komponent) som för
  `'presence'`-prompter visar en pulserande YubiKey-ikon och texten
  "Tryck på din YubiKey för att bekräfta" utan inputfält — auto-stängs när
  IPC-eventet för "prompt klar" kommer (dvs när ssh-add/ssh returnerar).
- Samma UI-mönster ska triggas för SFTP-bakgrundsoperationer
  (`SFTPStorageProvider.ts`) — den känner redan till när den laddar en
  ephemeral agent (`ensureSmartcardAgentLoaded`, rad ~263–290 enligt grep);
  koppla samma askpass-instans dit så prompten syns även vid ren
  filhantering, inte bara i en aktiv terminalflik.
- Timeout-hantering: om ingen touch sker inom N sekunder (OpenSSH default är
  ofta serverberoende), visa en hint ("Väntar fortfarande... kontrollera att
  rätt YubiKey sitter i") snarare än att bara hänga tyst.

**Test:** koppla mot en server med PIV touch-policy `always`, verifiera att
modalen visas för (a) interaktiv SSH-session, (b) SFTP-uppkoppling utan
öppen terminalflik.

**Risk:** medel — kräver att parsa OpenSSH:s askpass-prompttext robust
(texten kan skilja mellan OpenSSH-versioner/plattformar). Bygg
klassificeringen som en allowlist av kända substrängar
(`confirm user presence`, `touch`, `tryck`) med fallback till nuvarande
PIN-beteende om inget matchar, så vi aldrig får en prompt som varken visar
input eller går vidare.

---

## 3. FIDO2 / OpenSSH Security Keys (`ed25519-sk` / `ecdsa-sk`)

**Mål:** Ge FIDO2 ett förstklassigt läge i profilen, separat från PIV-smartcard.

**Typer (`src/shared/types/ssh.ts`):**
```ts
export type SSHAuthType = 'password' | 'privateKey' | 'smartcard' | 'agent' | 'fido2';
```
Nytt fält på `SSHConnectionConfig`, t.ex.:
```ts
fido2KeyPath?: string;       // ~/.ssh/id_ed25519_sk (icke-resident) eller lämnas tomt för resident-läge
fido2Resident?: boolean;     // true = hämtas direkt från nyckeln via ssh-add -K, ingen fil på disk krävs
```

**Main-process:**
- Ny modul `src/main/smartcard/Fido2KeyManager.ts` (eget namn, skiljer den
  medvetet från `Smartcard*`-familjen eftersom PIV och FIDO2 är olika
  protokoll även om båda råkar leva på samma USB-pryl):
  - `listResidentKeys(): Promise<Fido2ResidentKey[]>` — kör
    `ssh-add -K` (laddar residenta nycklar i den privata agenten, samma
    mönster som `loadSmartcardIntoPrivateAgent`) följt av `ssh-add -l` för
    att lista dem.
  - `generateKey(opts: { resident: boolean; verifyRequired: boolean; outPath?: string })`
    — kör `ssh-keygen -t ed25519-sk [-O resident] [-O verify-required] -f <path>`.
    PIN/touch under generering går genom samma `AskpassServer`-instans som
    punkt 2 byggde ut.
  - Felfall att hantera explicit: ingen FIDO2-kapabel nyckel ansluten,
    firmware för gammal för `ed25519-sk` (då föreslå `ecdsa-sk` istället —
    ed25519-sk kräver nyare libfido2/OpenSSH-kombination på vissa
    plattformar), och användaren avbryter touch under generering.
- `IpcBridge.ts`: nya IPC-handlers, t.ex. `fido2:listResidentKeys`,
  `fido2:generateKey`, speglat i `preload/index.ts` och `window.multissh`-typen.

**Renderer:**
- `SSHProfileForm.tsx`: nytt auth-alternativ "FIDO2 / Hardware Security Key"
  med två underlägen:
  - **Resident**: knapp "Hämta nycklar från ansluten YubiKey" →
    listar `listResidentKeys()`-resultatet, användaren väljer en →
    `fingerprint` sparas i profilen (`fido2Resident: true`), ingen
    `privateKeyPath` behövs.
  - **Fil-baserad**: peka ut befintlig `id_ed25519_sk`/`id_ecdsa_sk` (samma
    UX som dagens `privateKeyPath`-väljare för `privateKey`-läget).
  - Guide-knapp "Generera ny nyckel på YubiKey" → formulär (resident ja/nej,
    verify-required ja/nej, filnamn) → kör `generateKey`, visar publika
    nyckeln direkt i UI med en "Kopiera"-knapp så användaren kan klistra in i
    serverns `authorized_keys` utan att lämna appen.

**Anslutningsflödet (`SSHPtyManager.ts`, `SFTPStorageProvider.ts`):**
- `authType === 'fido2'` med `fido2Resident: true` → samma mönster som
  smartcard idag: säkerställ en agent (privat eller delad
  `agent-per-session`), kör `ssh-add -K` istället för `ssh-add -s <lib>`,
  peka `ssh`/ssh2 mot den agentens socket.
- `authType === 'fido2'` med filväg → kan i `SSHPtyManager` (native `ssh`-
  binär) gå rakt via `-i <path>` precis som `privateKey` gör, eftersom
  OpenSSH-klienten hanterar `-sk`-filer nativt (touch-prompt kommer via
  terminalen eller askpass om `SSH_ASKPASS` är satt).
  I `SFTPStorageProvider.ts` (ssh2) är detta **inte** möjligt — ssh2 har
  inget stöd för `-sk`-nyckelformatet (det kräver att faktiskt prata med
  FIDO2-token via libfido2, vilket ssh2 saknar). Dokumentera denna
  begränsning tydligt i UI (gråa ur/varna i profilformuläret om SFTP-delen
  kommer att kräva en körande `ssh-agent` med nyckeln redan laddad, precis
  som nuvarande kommentar rad ~197–198 i `SFTPStorageProvider.ts` redan säger
  om `smartcard`/`agent`). Praktiskt: SFTP måste alltid gå via
  `authType: 'agent'`-vägen (extern eller vår egen agent) för FIDO2-nycklar,
  aldrig via en direkt filväg i ssh2.

**Test:**
- Generera resident nyckel, koppla ny profil, logga in interaktivt.
- Samma nyckel, öppna Filhanteraren (SFTP) mot samma profil → verifiera att
  agent-vägen används och touch-prompten (punkt 2) visas.
- Testa `ecdsa-sk`-fallback på en äldre YubiKey (4-serien saknar FIDO2 helt —
  verifiera att UI ger ett tydligt felmeddelande snarare än att bara
  timeouta).

**Risk:** medel–hög. Största risken är ssh2/SFTP-begränsningen ovan — måste
kommuniceras i UI så användare inte förväntar sig att en fil-baserad
`-sk`-nyckel fungerar för filöverföring utan agent.

---

## 4. Enhetsdetektering & statusindikator

**Mål:** Diskret status i UI: vilken YubiKey sitter i, serienummer, vilket
läge (PIV/FIDO2), utan att användaren behöver gissa.

**Ansats — undvik ny nativ HID/PCSC-binding om möjligt:**
- Förstahandsval: shell ut till `ykman info` (och `ykman piv info`,
  `ykman fido info` vid behov) periodiskt (polling var 3–5:e sekund, eller
  vid USB-attach/detach-event om Electron/OS ger ett sådant billigt) och
  parsa textutdata. Kräver att `ykman` finns installerat — grader ur
  indikatorn till "YubiKey Manager (ykman) hittades inte" istället för att
  krascha eller tiga.
- Om `ykman` saknas: fall tillbaka till att bara visa "Smartcard-bibliotek
  hittat: OpenSC/libykcs11/..." (dvs. nuvarande `SmartcardDetector`-nivå av
  information) — ingen ny hård dependency införs.
- Ny modul `src/main/smartcard/YkmanStatus.ts`: `getStatus(): Promise<YubikeyStatus | null>`,
  cachead med kort TTL för att inte spamma `execFile` vid varje render.
- UI: liten indikator (statusrad eller Connection Manager-header), klick →
  popover med serienummer, firmware, PIV-slot/cert-info (redan tillgängligt
  via `CertificateParser.ts`/`SmartcardCertificateReader.ts` — återanvänd),
  samt residenta FIDO2-nycklar (punkt 3:s `listResidentKeys()`).

**Test:** ansluta/koppla ur YubiKey medan appen är öppen, verifiera att
statusen uppdateras utan att kräva app-omstart.

**Risk:** låg–medel. Polling av extern process är billigt att göra fel
(för aggressiv polling stör PIV-transaktioner som redan är in-flight — se
`Pkcs11Lock.ts`-kommentaren om att bara en transaktion i taget tillåts).
Måste dela samma lås/kö som `SmartcardAgentLoader` använder, eller undvika
att polla `ykman piv info` medan en `ssh-add -s` pågår.

---

## 5. Vault-upplåsning via FIDO2 (WebAuthn PRF / hmac-secret)

**Mål:** Låsa upp sshs3s egna synk-valv (`SmartcardSyncService.ts`) med ett
touch på YubiKey istället för/utöver PKCS#11 RSA/Ed25519.

**Bedömning:** detta är den mest osäkra punkten och bör tidsboxas som en
spike innan den planeras in i en release.

- **Teknikval:** ren `hmac-secret`-extension via `libfido2`/`fido2-hmac`
  (samma mekanism som KeePassXC använder) kräver antingen ett natively
  kompilerat Node-tillägg mot libfido2, eller att shella ut till ett
  CLI-verktyg (`fido2-token`/egen liten Go/Rust-binär) — Electron har ingen
  inbyggd WebAuthn-API i main-process (WebAuthn är annars en
  browser/renderer-grej bunden till en RP-origin, vilket inte passar en
  Electron-app utan en riktig webbserver-origin).
- **Konsekvens:** detta är **inte** samma enkla "shella ut till ssh-add"-
  mönster som punkt 1–3. Kräver antingen:
  (a) en ny nativ dependency (t.ex. `node-fido2-hmac` om ett sådant paket
  finns och underhålls, annars eget native binding), eller
  (b) en medföljande liten CLI-binär per plattform som appen buntar med
  sig (ökar `electron-builder`-paketets storlek och underhållsbörda).
- **Rekommendation:** gör en teknisk spik (max 2–3 dagar) som svarar:
  finns ett underhållet npm-paket eller statisk CLI-binär för
  `hmac-secret` på alla tre plattformar (Linux/Windows/macOS) som sshs3
  redan stödjer? Om nej på någon plattform, nedgradera detta till "Linux +
  Windows only" eller skjut på hela punkten till efter 1–4 är klara.
- Om spiken går igenom: `SmartcardSyncService.ts` får ett nytt
  `unlockMethod: 'pkcs11' | 'fido2-hmac'`, och samma
  PIN/touch-UX-komponent från punkt 2 återanvänds för touch-bekräftelse vid
  upplåsning.

**Risk:** hög. Enda punkten i planen som kräver ny nativ dependency/binär
distribution snarare än att bara orkestrera redan installerade
kommandoradsverktyg (`ssh-add`, `ssh-keygen`, `ykman`). Föreslås göras sist,
och bara efter en uttrycklig spike-approval.

---

## Sammanfattning – rekommenderad ordning för PR:ar

1. `libykcs11` i `SmartcardDetector` (litet, snabbt, ingen risk).
2. Touch-prompt UI, byggd ovanpå befintlig `AskpassServer`/`SmartcardPinModal`.
3. FIDO2 `ed25519-sk`/`ecdsa-sk`-stöd i profilformulär + ny `Fido2KeyManager`,
   med tydlig UI-varning om SFTP/ssh2-begränsningen.
4. Enhetsdetektering/statusindikator via `ykman` (kan göras parallellt med 3).
5. WebAuthn PRF/hmac-secret vault-upplåsning — spike först, egen plan sedan.
