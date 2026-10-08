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
