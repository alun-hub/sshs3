# Säkerhet, Hårdvarunycklar & Smartcards (Senior Säkerhetsguide)

Säkerhet och integritet är grundfundamenten i **sshs3**. Applikationen är utformad kring principerna om **Zero Private Key Extraction** och strikt minnesisolering.

---

## 1. Zero Private Key Extraction-Arkitektur

En avgörande skillnad mellan sshs3 och andra klienter är att **privata nycklar aldrig exponeras för JavaScript-, Node- eller renderer-minnet**:

- **FIDO2 / WebAuthn-nycklar (YubiKey)**:
  De kryptografiska signaturerna utförs direkt på säkerhetschippet i maskinvaran. Den privata nyckeln kan tekniskt inte extraheras av någon mjukvara på datorn.
- **Smartcards (PKCS#11)**:
  Nycklarna bor i smartcardets skyddade element. Signeringar delegeras via PKCS#11-modulen (`p11-kit`, `libykcs11`, `opensc`).
- **Mjukvarunycklar på disk (`id_ed25519`, `id_rsa`)**:
  Läses och hanteras uteslutande av ditt operativsystems egna `ssh`-binär. sshs3 läser, parsar eller lagrar aldrig dina privata nyckelbytes i applikationens minne.

---

## 2. Visuell Touch-Presence Banner

När du autentiserar mot en server med en FIDO2-hårdvarunyckel (`ed25519-sk` eller `ecdsa-sk`) kräver säkerhetsnyckeln fysisk användarnärvaro:

```
┌────────────────────────────────────────────────────────────────────────┐
│ 🔑 Touch your security key to authenticate...                          │
└────────────────────────────────────────────────────────────────────────┘
```

### Varför Bannern är Kritiskt Viktig (UX & Säkerhet):
- I traditionella CLI-terminaler händer det ofta att anslutningen till synes "fryser" eller hänger sig i väntan på att användaren ska upptäcka att YubiKeyn blinkar diskret under bordet.
- sshs3 känner av när OpenSSH-handskakningen begär användarverifiering och visar en animerad guldskimrande banner längst upp i fönstret:
  > *"Touch your security key to authenticate..."*
- **Timeout**: Om du inte vidrör nyckeln inom OpenSSH:s tidsgräns (oftast ~30 sekunder) avbryts handskakningen med ett tydligt felmeddelande istället för att hänga kvar.

---

## 3. Resident vs. Non-Resident FIDO2-Nycklar

När du konfigurerar en FIDO2-profil i sshs3 kan du välja mellan två lägen:

### A. Non-Resident Nycklar (Filbaserade)
- **Hur det fungerar**: En liten pekarnyckel (`id_ed25519_sk` och `id_ed25519_sk.pub`) genereras och sparas på din hårddisk. Filen innehåller ett "key handle" som pekar på hårdvarunyckeln.
- **Fördel**: Enkelt att hantera via standard OpenSSH-konfigurationsfiler.
- **Begränsning**: Om du byter dator måste du flytta med dig din `id_ed25519_sk`-fil till den nya maskinen.

### B. Resident / Discoverable Credentials (Inbyggda)
- **Hur det fungerar**: Nyckeln och dess metadata lagras direkt inuti själva hårdvarunyckeln (t.ex. YubiKey 5).
- **Hur det används**: Klicka på **Scan Security Key** i profilformuläret. sshs3 läser in alla residenta nycklar direkt från nyckeln utan att du behöver ha några filer på disken.
- **Fördel**: Maximal mobilitet. Du kan plugga in din YubiKey i vilken dator som helst och omedelbart ansluta utan att behöva kopiera några filer.

---

## 4. Efemära PIN-Caching Strategier

För att skydda smartcards och PIN-skyddade säkerhetsnycklar erbjuder sshs3 tre finkorniga policys:

![Säkerhetsinställningar](/img/docs/settings-security.png)

1. **Per-Session (Standard)**:
   - Du anger din PIN-kod när du ansluter. Koden behålls i flyktigt minne endast under själva inloggningshandskakningen och rensas därefter omedelbart.
2. **Global (App Lifetime) — Rekommenderas för hög produktivitet**:
   - PIN-koden sparas i säkert, krypterat flyktigt RAM-minne under den tid sshs3 körs.
   - När du öppnar nya delade split-paneler, nya flikar, startar SFTP eller kör `git pull` i ett lokalt skal återanvänds det upplåsta kortet automatiskt utan att du behöver slå din PIN-kod tjugo gånger om dagen.
   - **Säkerhetsgaranti**: Koden skrivs **ALDRIG till disk**. I samma ögonblick som du avslutar sshs3 (<kbd>Ctrl+Q</kbd>) töms minnet fullständigt.
3. **Never (Högsta säkerhetskrav)**:
   - Kräver PIN-kod vid precis varje enskild kryptografisk signering.

---

## 5. Kryptering av Sparade Uppgifter i Vila (At-Rest Encryption)

När du väljer att spara lösenord, proxylösenord eller S3-åtkomstnycklar i sshs3 skyddas de av operativsystemets hårdvarunära nyckelringar:
- **Linux**: GNOME Keyring / KWallet via `libsecret` (Secret Service API).
- **Windows**: Windows Credential Manager / DPAPI (Data Protection API).
- **macOS**: Apple Keychain Services.
- **Passphrase Vault (Fallback)**: Om du kör i en minimal miljö utan en aktiv Secret Service-demon krypteras databasen med **AES-256-GCM** skyddad av ett huvudlösenord.
