# Team-valv – implementationsplan

Status: planering klar, redo för Fas 1. Alla vägval nedan är beslutade
(2026-09-28) — se §7 för beslutslogg.

Utgångsläge (verifierat i kodbasen 2026-09-28):

- Dagens sync (`SyncCryptoService.ts`) är **lösenordsbaserad**: ett delat
  master-lösenord → scrypt → AES-256-GCM-nyckel per `SyncKeyGroup`
  (`topology` / `credentials`). Alla som kan lösenordet har allt. Ingen
  spårbarhet, ingen granulär offboarding (byt lösenord = alla måste byta).
- `pkcs11js` är redan ett beroende. `SmartcardCertificateReader.ts` läser
  redan X.509-certifikat (publik del) från PIV-kort via en isolerad
  child-process-worker (`certWorker.cjs`), men gör **ingen** privat
  nyckeloperation (`C_Login`/`C_Decrypt`/`C_DeriveKey`) — det är rent
  informativt idag.
- `Fido2KeyManager.ts` hanterar FIDO2 enbart som SSH-auktoriseringsnycklar
  (`ed25519-sk`/`ecdsa-sk` via `ssh-keygen`). Ingen CTAP2 `hmac-secret`
  (PRF)-användning finns. `docs/yubikey-fido2-plan.md` (punkt 5) har redan
  flaggat "Vault-upplåsning via WebAuthn PRF/hmac-secret" som en separat,
  ej påbörjad spike med hög insats.
- `S3StorageProvider.ts` pratar valfri S3-kompatibel endpoint (MinIO
  inkluderat) rent objektlagringsmässigt — ingen egen audit-logik.

Detta är en **helt separat feature** vid sidan av dagens lösenordsbaserade
sync (beslutat), inte en migrering. Egen S3-prefix/fil, eget UI-flöde, ingen
påverkan på befintliga `SyncCryptoService`-användare.

---

## 1. Mål och icke-mål

**Mål:**
- Ett team kan dela anslutningsprofiler och systemkonton (root/admin-lösenord,
  privata nycklar) utan ett gemensamt hemligt lösenord.
- Varje medlem låser upp valvet med sin egen hårdvarunyckel (PIV-cert
  primärt, FIDO2 sekundärt).
- Offboarding är omedelbar och kryptografiskt bindande, inte bara en
  UI-borttagning.
- Adminroll kan delegeras/utökas utan "team-ceremonier".

**Icke-mål (viktigt att vara tydlig om, annars blir förväntningarna fel):**
- **sshs3 bygger ingen egen audit-logg.** Beslutat: ansvaret för
  "vem hämtade/skrev vilken fil när" läggs helt på S3-lagret (MinIO
  server-side audit logging + bucket versioning + ev. OIDC/STS), inte i
  appen. sshs3:s enda skyldighet är att **inte undergräva** den möjligheten
  (se §5).
- Vi loggar aldrig "vem dekrypterade vilket fält" — det sker client-side
  och kan per definition inte observeras av servern. Detta ska stå
  explicit i UI/dokumentation så ingen tror att S3-audit-loggen visar
  det.
- Ingen egen krypto-primitiv uppfinns. Allt bygger på redan existerande,
  granskade byggstenar (Node `crypto`, PKCS#11 via `pkcs11js`, ev. `age`).

---

## 2. Kryptografisk design

### 2.1 Nyckelhierarki

- **Vault Key** (symmetrisk, AES-256-GCM): slumpas i RAM, krypterar
  `encrypted_payload`. Existerar aldrig i klartext på disk eller i S3.
- **Recipient-nycklar** (asymmetriska, en per medlem + en recovery-nyckel):
  Vault Key wrappas separat för varje recipient i `access_header`.

### 2.2 Recipient-mekanism: PIV primärt, FIDO2 sekundärt

Beslutat: PIV-cert är förstahandsstöd, FIDO2 är "vill ha men med känd
begränsning". De är kryptografiskt olika problem och måste beskrivas
separat.

**PIV (primärt) — asymmetrisk, fungerar precis som förväntat:**

PIV-nycklar stödjer riktig public-key-kryptering. **Beslutat (2026-09-28):
v1 stödjer bara RSA-slot** (YubiKey PIV-default för key management-sloten
`9d`) — det täcker det aktuella teamets kort. EC-slot (P-256/P-384) är
medvetet utanför scope för första leveransen; `age-plugin-yubikey` klarar
båda internt, så att lägga till EC-stöd senare är en validerings-/
UI-uppgift, inte ny kryptokod (se §6, gamla Fas 2 är nu bara en framtida
uppföljare, inte en Fas 1-blockare).

**Beslutat (2026-09-28):** bygg på `age` + `age-plugin-yubikey` (Rust-binärer,
MIT-licens, skriven av samma person som `age`) i stället för att hand-rulla
PKCS#11 `C_DeriveKey`/OAEP-kod själva. Appen shell:ar redan ut till externa
CLI-verktyg för säkerhetskritiska operationer (`ssh-keygen`, `ykman`,
PKCS#11-libbar via `certWorker.cjs`) — samma mönster, inte ett nytt.
`age-plugin-yubikey` ger oss:
- Multi-recipient-filformat gratis (`age -r <recipient1> -r <recipient2> ...`)
- Redan löst PIN/touch-hantering för PIV-slot
- Ingen egen ECDH/OAEP-implementation att få fel

Konsekvens: `wrapped_vault_key` i §2.3 blir i praktiken "Vault Key
krypterad som ett age-meddelande med en eller flera
`age1yubikey1...`-recipients", inte ett eget wrap-format. `pkcs11js`
behövs då inte längre för själva vault-kryptot (den kan fortfarande
finnas kvar för befintlig PIV-cert-listning i
`SmartcardCertificateReader.ts`, som är en separat funktion).

**FIDO2 (sekundärt) — symmetrisk, kräver ett annat enrollment-flöde:**

FIDO2/WebAuthn har ingen public-key-decrypt-operation. Det som finns är
CTAP2 `hmac-secret`-extensionen (även kallad PRF i WebAuthn L3): given en
salt, returnerar autentiseraren en deterministisk 32-byte-hemlighet —
men **bara när nyckeln är fysiskt närvarande**, för både skriv och läs.

Konsekvens för vårt flöde: att lägga till en FIDO2-medlem kräver att
**medlemmens egen nyckel är närvarande vid enrollment** (för att derivera
KEK:en som wrappar Vault Key), inte bara medlemmens publika info som med
PIV. I praktiken: medlemmen kör en lokal "generera min recipient-blob"-
funktion (touch krävs), skickar bara den **wrappade** Vault-Key-biten till
admin (aldrig hemligheten själv) för insättning i `access_header`. Lite
mer friktion än PIV men fortfarande säkert — ingen hemlighet lämnar
enheten okrypterad.

**Rekommendation:** bygg PIV-vägen i Fas 1, FIDO2 som Fas 4/stretch (redan
flaggat som separat spike i `yubikey-fido2-plan.md`). Blanda inte ihop de
två enrollment-flödena i första versionen.

### 2.3 Vault-filformat (utökning av `SyncCryptoService`-mönstret)

Ny klass, t.ex. `TeamVaultCryptoService`, separat från `SyncCryptoService`
(delar inte nyckelgrupp-koncept — helt annan trust-modell). JSON-kuvert,
inte binärt blob-format som dagens sync, eftersom `access_header` behöver
vara läsbart/diffbart utan att dekryptera nyttolasten:

```jsonc
{
  "format_version": 1,
  "vault_id": "vlt_<uuid>",
  "updated_at": "2026-09-28T19:00:00Z",
  "updated_by": "<recipient_id som gjorde skrivningen>",
  "access_header": [
    {
      "recipient_id": "alice@piv:<sha256 av certet>",
      "role": "admin",
      "method": "piv-rsa-oaep",
      "wrapped_vault_key": "<base64>",
      "added_at": "2026-09-28T19:00:00Z",
      "added_by": "<recipient_id>"
    }
  ],
  "recovery": {
    "recipient_id": "recovery-key-1",
    "wrapped_vault_key": "<base64>",
    "note": "Fysisk kopia i kassaskåp, genererad vid init"
  },
  "encrypted_payload": "<base64, AES-256-GCM under Vault Key, AAD=vault_id+format_version>"
}
```

Anmärkningar:
- `recipient_id` är inte bara ett namn — bind den till nyckelns fingeravtryck
  (SSH-fingerprint av certets publika nyckel, som `SmartcardCertificateReader`
  redan beräknar), annars kan en borttagen+återskapad identitet med samma
  namn förvirra revokering.
- `updated_by`/`added_by` ger en **lokal** ändringshistorik i filen själv,
  som komplement till (inte ersättning för) S3:s serverloggning — bra för
  "vem gjorde senaste skrivningen" utan att behöva fråga S3.
- Recovery-nyckeln är en vanlig recipient, inte ett specialfall i koden —
  bara flaggad separat i UI så den hanteras med rätt ceremoni (se §4.3).
- `method` är ett öppet fält (bara `"piv-rsa-oaep"` i v1) så att
  `"piv-ecdh-p256"`/`"fido2-hmac-secret"` kan läggas till senare utan
  formatändring.

---

## 3. Datamodell för vad som faktiskt synkas

`encrypted_payload` (efter dekryptering) återanvänder befintliga
domänmodeller så vi slipper en tredje profil-representation:
anslutningsprofiler + systemkonton uttryckta med samma fält som
`ProfileSyncService.ts` redan känner till.

**Beslutat (2026-09-28):** åtkomst är allt-eller-inget i v1 — alla
recipients i valvet ser hela `encrypted_payload`. Inga grupper/scopes
(t.ex. "bara prod-admins ser prod-db-01") i första vändan; det kan läggas
till som en senare utbyggnad av datamodellen om behovet uppstår, utan att
det underliggande vault-formatet i §2.3 behöver ändras (en scope-nivå
skulle i så fall bli ytterligare ett krypterat lager inuti payloaden,
inte en ändring av `access_header`).

---

## 4. Arbetsflöden

### 4.1 Initiering (första admin)
1. Admin genererar Vault Key i RAM.
2. Admin lägger till sig själv som första recipient (PIV-cert, roll `admin`).
3. Admin genererar en **recovery-nyckel** direkt (inte valfritt, se §4.3):
   **beslutat (2026-09-28)** — ett vanligt age-identity-par, där admin
   skriver ut den privata identiteten (papper) för förvaring i kassaskåp.
   Ingen andra fysiska säkerhetsnyckel krävs i v1.
4. Skriver till S3 under ett nytt prefix, t.ex. `team-vault/<vault_id>.json`.

### 4.2 Daglig användning
1. Ladda ner filen, slå upp egen `recipient_id` i `access_header`.
2. Om PIV: kör wrap-check mot kortet (PIN-prompt via befintlig
   `AskpassServer`/`SmartcardPinModal`-mönster) → få Vault Key i RAM.
3. Lås upp `encrypted_payload`, visa profiler/systemkonton.
4. Cacha Vault Key i Electrons `safeStorage` för resten av sessionen (som
   föreslaget) — men **bara i RAM-backed store, aldrig till vanlig disk-JSON**
   utan OS-nyckelring, annars är hela poängen med hårdvarubunden upplåsning
   borta om disken stjäls.

### 4.3 Medlemshantering
- **Lägg till (PIV):** admin behöver bara medlemmens publika certifikat
  (kan skickas via mail/Slack, det är publik info) → wrap Vault Key → lägg
  till i `access_header` → skriv fil. Ingen annan medlem påverkas.
- **Lägg till (FIDO2):** kräver ett extra steg där den nya medlemmens nyckel
  är fysiskt närvarande vid en av admins eller sin egen dator för att
  producera `wrapped_vault_key` (se §2.2). UI måste förklara detta extra
  steg tydligt så det inte upplevs som ett fel.
- **Ta bort (offboarding):** generera **ny** Vault Key, kryptera om
  `encrypted_payload`, wrap:a nya nyckeln för alla kvarvarande recipients
  UTOM den borttagna, skriv fil. Gamla filversioner i S3 (om
  versionering är på, se §5) innehåller fortfarande gammal Vault Key
  wrap:ad för den borttagna medlemmen — de kan alltså läsa historik de
  redan hade tillgång till, men inte något skrivet efter borttagningen.
  Detta ska stå explicit i UI: "Bob förlorar åtkomst till framtida
  ändringar, inte till det han redan synkat/hämtat."
- **Admin-överlämning:** ändra `role` på en recipient, ingen re-keying
  krävs (rollen styr bara UI-behörighet, inte kryptot — alla admins och
  medlemmar delar samma Vault Key by design, annars kan inte medlemmar
  läsa varandras data).
- **Multi-admin-regel:** UI ska varna (inte blockera) om ett skrivande
  som lämnar valvet med < 2 admins.

---

## 5. Vad S3/MinIO förväntas leverera (audit, helt utanför sshs3)

Eftersom sshs3 uttryckligen INTE ska äga audit-ansvaret, är detta en lista
över driftskrav på S3-lagret, inte kod vi skriver:

- Bucket-versionering påslagen (ger också gratis rollback om en admin
  råkar skriva en trasig fil).
- MinIO server-side audit logging (webhook eller till SIEM) konfigurerad
  av teamets infra-ansvarige, inte av sshs3.
- Om spårbarhet per faktisk person (inte bara "någon med giltiga
  S3-nycklar") önskas: MinIO + OIDC/STS mot företagets IdP — helt en
  S3/infra-konfigurationsfråga, sshs3 behöver bara kunna autentisera mot
  en STS-endpoint precis som mot vilken S3-kompatibel endpoint som helst.
  **sshs3:s enda kodåtagande här:** se till att `S3StorageProvider`
  redan (eller efter en liten utökning) kan hämta temporära STS-credentials
  i stället för statiska access keys, om det inte redan stöds — värt att
  verifiera mot `S3StorageProvider.ts` innan vi lovar det.

---

## 6. Faser och PR-uppdelning

| Fas | Innehåll | Beroenden |
|---|---|---|
| 1 | Bunta `age` + `age-plugin-yubikey`-binärer per plattform (Linux/macOS/Windows) i appens build/release, samma mönster som andra bundlade externa verktyg; `TeamVaultCryptoService`: vault-format (§2.3), AES-GCM-payload, wrap/unwrap av Vault Key via `age` CLI + `age-plugin-yubikey` mot PIV RSA-slot | Nya binärer att bunta i CI/release |
| 2 | Admin-UI: skapa valv, lägg till/ta bort/befordra medlem, generera + visa recovery-nyckel för utskrift, visa recipient-lista med fingeravtryck, varning vid <2 admins | Fas 1 |
| 3 | S3-integration: eget prefix, konfliktlösning vid samtidig skrivning (optimistic concurrency via ETag — `S3StorageProvider` bör redan ha något liknande för befintlig sync, återanvänd det mönstret) | Fas 1, 2 |
| 4 (framtida, ej v1) | EC-slot-stöd (P-256/P-384) för PIV-kort som saknar RSA i key management-sloten — validering mot `age-plugin-yubikey`, ingen ny kryptokod | Fas 1 |
| 5 (framtida, ej v1) | FIDO2 `hmac-secret`-recipients | Fas 1, `yubikey-fido2-plan.md` punkt 5 |
| 6 (framtida, ej v1) | Grupper/scopes för granulär delning inom valvet | Fas 1–3 |

---

## 7. Beslutslogg

Alla vägval för v1 är låsta (2026-09-28):

1. **Krypto-implementation:** `age` + `age-plugin-yubikey` i stället för
   egen PKCS#11 OAEP/ECDH-kod. Se §2.2/§6.
2. **Åtkomstmodell:** allt-eller-inget i v1, inga grupper/scopes. Se §3.
3. **Kortstöd:** enbart PIV RSA-slot i v1; EC-slot är en framtida
   uppföljare (Fas 4), inte en blockare för första release. Se §2.2/§6.
4. **Recovery-nyckel:** ett age-identity-par som skrivs ut på papper för
   kassaskåpsförvaring, ingen andra fysisk säkerhetsnyckel krävs. Se §4.1.
5. **Distribution:** `age` och `age-plugin-yubikey` buntas med sshs3
   per plattform i build/release, användaren installerar inget separat.
   Se §6, Fas 1.

Inga öppna frågor kvarstår för att påbörja Fas 1.

**Fas 1 implementerad (2026-10-08).** Precisering av Fas 1-raden ovan:
bundlingen omfattar **Linux + Windows**, inte macOS — det är de enda
plattformar `ci.yml`/`release.yml` faktiskt bygger idag (appen har ingen
macOS-CI). `TeamVaultCryptoService` (vault-kuvertet i §2.3: AES-256-GCM,
AAD=vaultId+formatVersion, `generateVaultKey`/`encryptPayload`/
`decryptPayload`/`wrapVaultKeyForRecipient`/`unwrapVaultKey`) och
`AgeBinaryResolver` (paketerad `extraResources` → dev
`build-resources/age/<platform>` → PATH, i den ordningen) finns i
`src/main/services/`. `.github/workflows/release.yml` och
`electron-builder.json` hämtar och SHA256-pinnar `age` v1.3.2
(Linux+Windows) och `age-plugin-yubikey` **v0.5.0** — medvetet inte
"latest": v0.5.1 (verifierat mot GitHub Releases API 2026-10-08) tappade
Linux-binären helt ur sina release-assets (bara Darwin+Windows kvar), så
v0.5.0 är senaste versionen som fortfarande ger matchande Linux- och
Windows-binärer. Bevaka detta vid framtida uppgraderingar av pluginet.

Kvarstående, medvetet olösta risker inför Fas 2/3:
1. Kan `age-plugin-yubikey` ta emot PIN icke-interaktivt (via stdin)?
   Inte verifierat mot riktig YubiKey-hårdvara. Om inte: `unwrapVaultKey`
   behöver en pty-wrapper (appen har redan `node-pty`) i stället för
   vanlig stdin-piping — en omskrivning av process-spawningen, inte av
   vault-formatet.
2. `age-plugin-yubikey` kräver `pcscd` installerad och körande på Linux —
   ett nytt runtime-beroende utöver dagens PKCS#11-middleware-krav, ännu
   inte dokumenterat för slutanvändare.

**Fas 2 implementerad (2026-10-08) — lokalt valv, ingen S3 än.**
`TeamVaultService` (`src/main/services/`) äger valvfilen
(`<userData>/team-vault.json`, samma katalogkonvention som
`SyncConfigStore`) och skriver via `queueMutation` (CLAUDE.md-krav).
Admin-UI i `SettingsModal` → "Team Vault": generera egen PIV-recipient,
skapa valv, lägg till/ta bort/befordra medlem, <2-admin-varning,
engångsvisning av recovery-nyckeln med bekräftelsekryss innan dialogen
går att stänga.

**Korrigering av §2.3:** `TeamVaultAccessEntry`/`TeamVaultRecovery` har
fått ett tillkommande fält, `ageRecipient` (den publika
`age1yubikey1...`-strängen, i klartext — redan publik info per §4.3).
Utan det kan `removeMember`s re-keying (§4.3: ny Vault Key, om-wrap för
alla kvarvarande) inte genomföras — `wrapped_vault_key` är envägs och
går inte att återställa en publik nyckel ur. Ren komplettering, ingen
säkerhetsförsämring.

**PIN-prompt medvetet INTE kopplat in än.** `IpcBridge.promptForPinDirect()`
(redan återanvänd av `ProfileSyncService`s smartcard-upplåsning, med
`kind: 'smartcard'`) hade kunnat återanvändas rakt av för Team Vault-PIN
också — men `TeamVaultService.unlock()` anropar `unwrapVaultKey` direkt
utan att samla in ett PIN alls, eftersom det inte finns någon verifierad
icke-interaktiv kanal att mata in det i `age-plugin-yubikey` på (se risk
#1 ovan). Att koppla in prompten innan den kanalen är löst hade bara gett
dödkod (ett PIN som samlas in och sedan kastas bort) — görs när #1 är
verifierad mot riktig hårdvara.

**Fas 3 implementerad (2026-10-08) — S3-integration.** `TeamVaultConfigStore`
(eget S3-mål, separat fil från `SyncConfigStore` — `<userData>/team-vault-sync-config.json`,
samma `SecretFieldCrypto`-kryptering av nycklar) plus `TeamVaultService.pushToRemote`/
`pullFromRemote`/`hasRemoteVault` (ny IPC: `team-vault:set-target`,
`team-vault:push`, `team-vault:pull`, `team-vault:has-remote-vault`).
Fast remote-nyckel `team-vault/vault.json` under det konfigurerade
`bucket[/prefix]`. Admin-UI:t har en "Remote sync (S3)"-sektion
(mål-konfiguration återanvänder `SyncTargetForm`, Push/Pull-knappar) och
en "Pull existing vault"-väg när ingen lokal fil finns men en redan gör
det i molnet (en ny medlem som ansluter till ett befintligt team-valv).

**Korrigering av §6:s ETag-antagande.** Verifierat mot kodbasen:
`S3StorageProvider` har ingen `If-Match`/villkorlig skrivning — `stat()`
kan bara LÄSA en ETag. Den faktiska, redan beprövade mekanismen i
`ProfileSyncService` är storlek+mtime-jämförelse mot senast observerad
`FileEntry`, med avslå-och-be-om-pull-först (`SyncConflictError`), inte
ETag/`If-Match`. `TeamVaultService` speglar exakt detta mönster
(`TeamVaultSyncConflictError`) i stället för att bygga ny, mindre
portabel S3-kod (riktig villkorlig skrivning stöds inte konsekvent över
AWS/MinIO-versioner). Push/pull är manuellt (knappar), inte automatiskt
efter varje medlemsändring — samma UX-princip som Remote Profile Sync.

En säkerhetsgranskning innan Fas 3 påbörjades hittade också en
under-validerad IPC-arg-sink i `teamVaultHandlers.ts` från Fas 2
(`ageRecipient`/`identityFilePath` kunde tolkas som en CLI-flagga av
`age` i stället för sitt avsedda värde) — åtgärdad med valideringsguards
i både handler-lagret och vid själva anropsstället i
`TeamVaultCryptoService`, med nya tester för båda.

**Ytterligare säkerhetsgranskning av Fas 3-committen (2026-10-08)**
hittade fyra fynd, alla åtgärdade:
1. **Trust-boundary-confusion:** `addedBy`/`removedBy`/`updatedBy` togs
   emot som renderer-angivna strängar (UI:t skickade bara den hårdkodade
   texten `'me'`) — den lokala ändringshistoriken §2.3 beskriver ("vem
   gjorde senaste skrivningen") var alltså ren dekoration, inte
   auktoritativ. `addMember`/`removeMember`/`setRole` tar INTE längre
   emot dessa som parametrar — `TeamVaultService` härleder dem nu från
   `unlockedAsRecipientId`, satt av `createVault`/`unlock()`. Som en följd
   kräver `setRole` nu också en upplåst session (tidigare kunde VEM SOM
   HELST, olåst, befordra en godtycklig recipient till admin).
2. **Fail-open konflikthantering vid push:** `lastKnownRemoteEntry ===
   undefined` (alltid sant efter en app-omstart) hoppade över
   konfliktkontrollen helt — ett nyskapat lokalt valv kunde då tysta
   skriva över ett helt annat, befintligt team-valv på samma S3-mål vid
   den första pushen. `pushToRemote` läser nu alltid remote-filens
   `vaultId` när något finns på målet, oavsett cache-state, och kastar
   `TeamVaultForeignVaultError` vid mismatch.
3. **Missing-integrity-check vid pull:** formatkontrollen var ytlig
   (bara toppnivå-fält) — ett trasigt `accessHeader`-objekt (t.ex.
   saknad `ageRecipient`) hade kraschat djupt inne i `removeMember`s
   om-wrap-loop i stället för att avvisas direkt. Ny `assertValidVaultFile`
   validerar hela formen. Samtidigt lades ett `revision`-fält till i
   `TeamVaultFile` (inkrementeras på varje skrivning) — `pullFromRemote`
   avvisar nu en remote-fil vars revision går bakåt (`TeamVaultRollbackError`),
   eftersom S3-skrivbehörighet inte är samma sak som att vara en
   legitim valv-recipient: någon med bara bucket-skrivåtkomst skulle
   annars kunna återställa en äldre version och återuppväcka en borttagen
   medlems åtkomst.
4. `pushToRemote`/`pullFromRemote` körs nu också genom `queueMutation`,
   så de aldrig interleavar med varandra eller med en samtidig lokal
   mutation (de delar `lastKnownRemoteEntry`/`unlockedVaultKey`-state).

**Uppföljande granskning (2026-10-08, samma dag) hittade att fixen ovan
var ofullständig: `pullFromRemote` saknade samma identitetskontroll som
`pushToRemote` redan fått.** `revision` är bara ett vanligt fält i en
osignerad JSON-fil — vem som helst med S3-skrivbehörighet (inte
nödvändigtvis en legitim recipient) kan ersätta HELA valvet med ett helt
annat (`vaultId`) och själv välja ett `revision`-tal högre än det lokala,
vilket seglade rakt förbi en rollback-kontroll som bara jämför tal.
`pullFromRemote` kontrollerar nu `vaultId`-identitet FÖRE
revision/rollback-kontrollen, och vägrar byta vilket valv den här
maskinen följer tyst — det kräver nu att man medvetet tar bort den
lokala filen först. Samtidigt lades en kontroll till mot dubbla
`recipientId`-värden i en pullad fil (kan annars skugga en riktig
medlems eller recovery-nyckelns post).

**Ytterligare granskning (2026-10-08, samma dag) hittade ett kvarvarande
hål i samma identitetskontroll:** `vaultId`/`revision`-kontrollerna
skyddar bara HELA filen, inte enskilda poster. Någon med S3-skrivbehörighet
(utan att vara en legitim recipient) kunde behålla `vaultId`, höja
`revision`, och bara byta ut en BEFINTLIG medlems `ageRecipient` mot sin
egen publika nyckel (lämna den posten `wrappedVaultKey` orörd — oskadlig
tills den återaktiveras). Attacken är overksam i sig (angriparen kan inte
förfalska en giltig `wrappedVaultKey` utan den riktiga Vault Key:n) — men
nästa gång en admin kör en helt rutinmässig `removeMember` (för att
avsluta någon helt annan persons åtkomst) om-wrappar den koden en FRÄSCH
Vault Key för varje kvarvarande posts `ageRecipient`, inklusive den
manipulerade — och ger då angriparen verklig åtkomst. `ageRecipient` för
ett givet `recipientId` ändras aldrig legitimt efter att det lagts till
(`addMember` vägrar en redan existerande `recipientId`), så
`pullFromRemote` jämför nu varje känd `recipientId`:s `ageRecipient` (i
`accessHeader` och recovery-posten) mot det tidigare kända värdet och
kastar `TeamVaultTamperedEntryError` vid mismatch.

**Ännu en granskning (2026-10-08, samma dag) hittade att kontrollen ovan
fortfarande var ofullständig ("incomplete-tamper-check / fail-open state
drift"):** den fångar bara SUBSTITUERADE befintliga poster, inte en
HELT NY, illegitim post en S3-skrivbehörighetsinnehavare kan sätta in
(eget `ageRecipient`, inget befintligt `recipientId` att kollidera med —
oskiljbar på fältnivå från en äkta `addMember` pushad från en annan
maskin, eftersom inget signeras). En sådan injicerad post skulle annars
tystlåtet bli en del av den "kända" lokala staten — "state drift" — och
precis som i föregående fynd återaktiveras av en helt vanlig framtida
`removeMember`.

Fullständig lösning kräver en signaturmekanism för access-header-poster
(inte byggd nu — se §6 som en framtida uppföljare, inte en Fas 3-blockerare).
En konkret, implementerbar delmängd finns dock: `addMember` och `setRole`
roterar ALDRIG Vault Key:n eller rör `encrypted_payload` — bara
`removeMember` gör det. Så ett enstegs-pull (`revision` exakt +1) vars
mottagarantal inte minskat (alltså inte en `removeMember`) MÅSTE, om
sessionen redan är upplåst, fortfarande kunna dekryptera `encrypted_payload`
med den Vault Key vi redan har — annars har den som skrev filen inte haft
den riktiga nyckeln, oavsett vilket fält de manipulerade. `pullFromRemote`
kör nu detta dekrypteringsförsök (bara vid enstegs-pull utan minskat
mottagarantal, för att inte falskt avvisa en legitim flerstegs-catchup
där en `removeMember` kan ingå och roterat nyckeln legitimt) när
sessionen är upplåst.

**En femte granskning (2026-10-08, samma dag) hittade att även
dekrypteringskontrollen ovan var en "ineffective-security-control" /
"incomplete-fix / bypassable integrity check":** villkoret
`revision === localFile.revision + 1` är ett vanligt, attacker-valt
fält i filen — angriparen kringgår kontrollen helt bara genom att sätta
`revision` till NÅGOT ANNAT än exakt +1 (t.ex. +2, eller till och med
samma revision som lokalt), varpå hela kontrollen hoppas över.

**Fix:** ersatt dekrypteringsheuristiken med en riktig
integritetskontroll av access-headern självt. `TeamVaultFile` har nu ett
`accessHeaderMac`-fält: HMAC-SHA256 över `vaultId`+`revision`+
`accessHeader`+`recovery`, nyckladd med en HKDF-härledd subnyckel från
Vault Key:n (inte samma råa AES-nyckel återanvänd till ett annat
primitiv). `createVault`/`addMember`/`removeMember`/`setRole` beräknar
och sätter fältet vid varje skrivning (`setRole` kräver nu även
upplåst Vault Key, inte bara identitet, för att kunna beräkna om MAC:en).
`pullFromRemote` verifierar nu MAC:en (när sessionen är upplåst och
mottagarantalet inte minskat) **oavsett vilket `revision`-delta
angriparen väljer** — att beräkna en giltig tagg kräver den riktiga
Vault Key:n, inte ett specifikt revisionsnummer, så det finns ingen
kringgående väg kvar via det fältet. Kvarstående, medvetet accepterad
begränsning: om angriparen OCKSÅ tar bort en riktig medlem för att få
mottagarantalet att se ut som en legitim `removeMember` (vilket hoppar
över kontrollen) kan de fortfarande smyga in en post — men det kräver
att de synligt raderar en riktig medlems åtkomst, vilket är betydligt
mer upptäckbart än en tyst substitution. Fullständig lösning (signerade
poster bundna till en specifik admin-identitet) kvarstår som framtida
arbete, se ovan.

---

## Hårdvaruverifiering (2026-10-09) — Fas 1/2:s öppna PIN-fråga är löst

Testat mot ett riktigt YubiKey 5C (PIV, slot 1/retired, `age-plugin-yubikey
--generate --pin-policy once --touch-policy always`), lokalt nedladdade
binärer (samma pinnade `age` v1.3.2 / `age-plugin-yubikey` v0.5.0 som CI
bundlar). Två körningar:

1. **Vanlig `execFile` (inga TTY, pipes)** — misslyckas omedelbart:
   `Error: Failed to get input from user: IO error: not a terminal`.
   Bekräftar den ursprungliga, odokumenterade misstanken.
2. **Samma kommando wrappat i `node-pty`** (redan ett beroende i appen) —
   kommer förbi TTY-kontrollen. Ett första försök med PIN skickad
   **programmatiskt** via `term.write(pin + '\r')` levererades korrekt
   till prompten (kortet validerade och avvisade PIN:en på rätt sätt —
   mekanismen fungerar, bara fel PIN testades då). Ett andra försök med
   rätt PIN (skriven av en människa i en egen terminal, aldrig i denna
   konversation) lyckades fullt ut: PIN godtogs, touch-prompten kom och
   besvarades, och ett giltigt identity/recipient-par skrevs ut.
   **Exit code 0.**

**Slutsats: icke-interaktiv PIN-matning till `age-plugin-yubikey`
fungerar — men bara via en `node-pty`-wrapper, aldrig via vanlig
`execFile`/pipes.** Det här var den enda kvarstående öppna frågan från
Fas 1/2 som blockerade att `TeamVaultCryptoService.unwrapVaultKey`/
`enrollOwnPivRecipient` faktiskt kan fungera i produktion. Nu
verifierad: **implementationen måste bytas från `execFile` till
`node-pty`** för dessa två metoder (parsa prompter ur pty-utskriften,
skriv PIN/svar programmatiskt, upptäck touch-prompten för UI-feedback).

**Ny upptäckt, inte tidigare dokumenterad:** på ett kort med
default-PIN/PUK (fabriksinställning) vägrar `age-plugin-yubikey
--generate` att generera en nyckel — det tvingar först igenom en
interaktiv PIN+PUK-bytesguide (flera steg: nuvarande PUK, ny PIN, ny
PUK). **PIN/PUK är kortövergripande, inte per-slot** — att slutföra den
guiden ändrar skyddet för ALLA befintliga slots på kortet, inte bara den
nya. Dessutom migrerar `--generate` på ett kort med default
management-key automatiskt till en PIN-skyddad management-key som ett
extra, odokumenterat steg i samma flöde. Konsekvens för Fas 1-3-koden:
`enrollOwnPivRecipient`/`unwrapVaultKey`:s pty-baserade ersättare måste
känna igen och hantera (eller åtminstone tydligt felmeddela på) dessa
extra guide-steg, inte bara en enkel PIN-prompt — annars hänger
anropet tyst tills vår egen timeout slår till, precis som i det första
testet här.

**Säkerhetsnotering från testet:** användarens nya PIN syntes olyckligt
i klartext i en inklistrad terminal-utskrift under testet (ekades inte
maskerad på den raden) och användaren bytte PIN igen direkt efteråt.
Ren processhygien för framtida hårdvarutester: mata ALDRIG en riktig
PIN genom AI-konversationen eller ett skript med hårdkodat PIN-värde —
låt användaren skriva den direkt i sin egen terminal, eller skicka den
programmatiskt från appens egen PIN-modal (aldrig loggad).

### Uppföljning (2026-10-09) — binärsäkerhet för `unwrapVaultKey` + en PIN-incident

Innan node-pty-ersättningen implementerades återstod en teknisk fråga
som ovanstående test inte täckte: `enrollOwnPivRecipient`s utdata är
ren text (identitetsstrofen), men `unwrapVaultKey`s faktiska nyttolast
(den upplåsta 32-byte Vault Key:n) är godtycklig binärdata på `age`s
stdout. `node-pty`s `onData` levererar UTF-8-avkodade strängar och
terminalens line discipline normaliserar CRLF (`ONLCR`) — att köra
hela `age -d`-processen genom en full `pty.spawn()` riskerar att tyst
korrumpera precis de bytes som betyder mest. Verifierat empiriskt:

1. `age -d` vägrar dessutom själv skriva binärdata till en terminal
   (`age: error: refusing to output binary to the terminal`, kräver
   `-o -` för att tvinga fram det) — ett medvetet säkerhetsbeteende i
   `age`, inte en bugg.
2. Lösning: låt PIN/touch-dialogen fortsätta gå över samma redan
   verifierade `pty.spawn()`-kanal (ren text, som `--generate`), men
   dirigera de faktiska nyckelbytena till en **FIFO** (ett namngivet
   rör skapat med `mkfifo`) via `age -d -i <identitet> -o <fifo-sökväg>`
   i stället för stdout. En FIFO är inte en terminal (ingen
   `ONLCR`/ECHO-korruption, inget "refusing binary"-fel) och skriver
   aldrig till disk (ren kernel-pipe-buffert, försvinner med
   processen) — så det bryter inte mot regeln i `CLAUDE.md` om att
   aldrig persistera hemligheter.
3. Verifierat mot riktig hårdvara: en slumpmässig 32-byte testnyttolast
   (inte den riktiga Vault Key:n) krypterades mot testrecipienten i
   slot 1 (mjukvaruoperation, ingen hårdvara inblandad), dekrypterades
   via `age -d -i <testidentitet> -o <fifo>` wrappat i `node-pty`, och
   levererades byte-för-byte identiskt via FIFO:n. **Bekräftat: denna
   kombination är binärsäker.**

**Konsekvens för implementationen:** `unwrapVaultKey`s pty-ersättning
ska använda `-o <fifo>`, läsa resultatet från FIFO:n (aldrig från
pty-textkanalen), och själva FIFO-filen skapas/tas bort kring varje
anrop (aldrig en långlivad fil på disk).

**Ny säkerhetsincident under detta uppföljningstest:** vid ett
diagnostik-steg (isolera om `-o <fifo>` eller TTY-kravet orsakade ett
tidigare, oförklarat fel) skickade jag av misstag en felaktig
"engångs-PIN" direkt mot det riktiga kortets PIV-PIN, i tron att den
var disposable — den är det inte, den delar samma 3-försök-räknare som
den riktiga PIN:en. Resultat: PIN gick från 3/3 till 2/3 försök kvar
innan låsning. Ingen permanent skada (PUK opåverkad, 3/3), användaren
körde `ykman piv access change-pin` själv och återställde räknaren till
3/3 (verifierat via `ykman piv info`, read-only). **Lärdom, skarpare än
den tidigare noteringen ovan: det finns inget "disposable" PIN-värde
att testa med mot ett riktigt kort — varje PIN-sträng som skickas till
en riktig YubiKey, rätt eller fel, avsiktligt eller diagnostiskt, räknas
mot den delade räknaren. Diagnostik som behöver se var ett flöde
bryter ska göras utan att skicka NÅGOT PIN-värde alls (t.ex. observera
fram till PIN-prompten, inte förbi den), eller frågas med användaren
innan varje sådant steg, inte bara innan de uppenbart "riktiga" PIN-
försöken.

### Implementerat (2026-10-09) — node-pty-ersättningen

`enrollOwnPivRecipient`/`unwrapVaultKey` i `TeamVaultCryptoService`
kör nu via `AgePtyPinRelay.runAgeCommandViaPty` (ny fil) i stället för
`execFile`: en riktig pty för PIN/touch-dialogen, med
`age-plugin-yubikey -o <fifo>` (FIFO, aldrig disk) för den faktiska
Vault Key-nyttolasten vid unwrap — se avsnittet ovan för härledningen.
Den en gång upptäckta default-PIN/PUK-guiden detekteras heuristiskt
(ordalydelsen är fortfarande inte fullt verifierad, se kommentar i
koden) och avbryter direkt i stället för att försöka svara på den.
`TeamVaultService.unlock`/`enrollOwnPivRecipient` relayar PIN/touch
via en ny `pinPrompter`-injektionspunkt (samma `promptForPinDirect`/
`makePresenceNotifier` som appens övriga PIV/FIDO2-flöden), kopplad in
i `IpcBridge`s konstruktion av `TeamVaultService` — ingen ny IPC-kanal
eller UI-komponent krävdes.

**Windows är fortfarande inte verifierat** (bara Linux denna omgång,
medvetet beslut) — `node-pty` använder ConPTY där, men huruvida
`age-plugin-yubikey` kräver en tty på samma sätt, och huruvida en FIFO
(`mkfifo`) ens är tillgänglig (den är inte det på Windows), är öppna
frågor för en separat verifieringsomgång innan Team Vault-funktionen
räknas som klar på Windows.

### End-to-end UI-verifiering (2026-10-09) — två verkliga buggar hittade och fixade

Testat via `run-desktop`-skillen mot riktig hårdvara, genom hela
UI-flödet (Settings → Team Vault → Generate recipient → Create Vault →
Lock/Unlock), inte bara enhetstester med mockad `node-pty`:

1. **`wrapVaultKeyForRecipient` saknade plugin-PATH** — samma
   `pluginPathEnv`-mönster som `unwrapVaultKey` redan hade, men aldrig
   applicerat på wrap-anropet. Eftersom wrap för en
   `age1yubikey1...`-mottagare fortfarande kör `age-plugin-yubikey`
   (bara för att tolka/validera mottagarsträngen — ingen PIN/touch
   inblandad), misslyckades `createVault`/`addMember` med "yubikey
   plugin not found" så fort en riktig YubiKey-mottagare användes,
   både i dev och i en paketerad build. Detta var ett existerande fel,
   inte orsakat av node-pty-omskrivningen, men aldrig upptäckt förrän
   nu eftersom ingen tidigare testat `createVault` mot en riktig
   hårdvarumottagare. Fixat genom att ge `wrapVaultKeyForRecipient`
   samma `pluginPathEnv`.
2. **Identitetsfilen innehöll hela den brusiga pty-transkripten** —
   `enrollOwnPivRecipient` skrev den FULLA texten `runAgeCommandViaPty`
   fångar (statusrader, det ekade PIN-fältet, touch-prompten) till
   identitetsfilen, inte bara den riktiga stansen
   (kommentarblock + `AGE-PLUGIN-YUBIKEY-...`-raden). `age -d -i
   <fil>` vägrade sedan filen ("unknown identity type"). Ny
   `extractIdentityStanza()`-funktion plockar ut exakt stansen
   (går baklänges från `AGE-PLUGIN-YUBIKEY-...`-raden genom
   sammanhängande `#`-kommentarsrader) innan filen skrivs.

Båda buggarna hade gjort hela Team Vault-funktionen obrukbar i
praktiken (ingen riktig YubiKey-medlem hade kunnat läggas till eller
låsa upp) trots att alla enhetstester (mockade) var gröna — ett bra
exempel på varför end-to-end-testning mot riktig hårdvara är värt
besväret, inte bara `npm test`.

**Övrigt observerat under testet:**
- `unlock()` fungerade end-to-end efter en engångs-flaky körning
  (samma diffusa "Failed to decrypt YubiKey stanza"-fel som sågs en
  gång under den tidigare hårdvarudiagnostiken, löste sig vid
  omförsök — PIN-räknaren påverkades inte, bekräftat orört via
  `ykman piv info`). Inte reproducerat på ett sätt som pekar på en
  specifik kodbugg; dokumenteras som känd, ovanlig flakiness i detta
  exakta anrop.
- **Ingen touch-notis visas i UI:t vid `unlock()`** — till skillnad
  från `enrollOwnPivRecipient` (`--generate`, som explicit skriver
  "👆 Please touch the YubiKey" i sitt CLI-läge) verkar `age -d`
  (plugin-protokolläge) inte skriva någon textprompt för touch alls —
  bara den blinkande lampan. `TOUCH_PROMPT_RE` i `AgePtyPinRelay.ts`
  har inget att matcha mot, så ingen bugg i koden, men en verklig,
  odokumenterad UX-lucka: appen vet inte när den ska visa
  touch-bannern vid upplåsning. Kvarstående, icke-blockerande arbete.

### Känd begränsning: endast YubiKey, inte generiska PIV-kort (2026-10-09)

Team Vaults hårdvarumodell är hårt knuten till `age-plugin-yubikey`,
som pratar YubiKeyns proprietära hanteringsprotokoll (serienummer,
slots, management key) — inte ett generiskt PIV/PKCS#11-gränssnitt.
Ett certifikat utfärdat via t.ex. OpenCA på ett annat PIV-kort
(Gemalto, Thales, SafeNet, m.fl.) kan alltså **inte** användas som
Team Vault-mottagare, oavsett om kortet i sig är PIV-kompatibelt —
`age-plugin-yubikey` känner helt enkelt inte igen det.

Appens befintliga, generiska PIV/PKCS#11-stack (`src/main/smartcard/`,
använd för SSH-autentisering) är helt frikopplad från Team
Vault-kryptot och löser inte detta. Att stödja andra PIV-kort skulle
kräva en parallell kryptoväg (t.ex. RSA-OAEP direkt via PKCS#11 för
att wrappa Vault Key:n i stället för `age`/`age-plugin-yubikey`) —
inte en liten ändring utan en separat arkitektur. Inte påbörjat;
dokumenteras som en känd begränsning, i samma kategori som
Windows-verifieringsgapet ovan.
