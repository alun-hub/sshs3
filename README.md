# sshs3

> **Modern, säker och mångsidig cross-platform SSH-, SFTP- och S3-klient** för Linux och Windows med stöd för smartcard (PKCS#11 / SITHS / Net iD), delade terminalvyer, dual-pane filhantering och molnlagring.

![sshs3 icon](build/icons/128x128.png)

---

## Översikt

**sshs3** kombinerar kraften hos en fullfjädrad xterm.js-terminal med en tvådelad filutforskare för både SFTP och S3-kompatibla lagringstjänster (AWS, MinIO, NetApp). Applikationen är skapad för systemadministratörer, DevOps- och utvecklingsteam som hanterar komplexa nätverksmiljöer, skyddade servrar bakom jump hosts/bastions och säkerhetskrav med hårdvarutokens och smartcard.

---

## Huvudfunktioner

### 🖥️ Terminal med flikar & delad vy (Split View)
- **OpenSSH-kärna via `node-pty`**: Fullständigt stöd för din befintliga `~/.ssh/config`, `ssh-agent`, nycklar och terminalalias.
- **Delad vy (Split Layout)**:
  - **Enkel vy**: Klassisk helskärmsterminal per flik.
  - **Vertikal delning**: 2 kolumner sida vid sida.
  - **Horisontell delning**: 2 rader över/under.
  - **2x2 Grid**: 4 samtidiga terminaler i samma flik för övervakning av serverkluster.
- **Oberoende paneler**: Varje delpanel har en egen anslutningsväljare och isolerad terminalsession.
- **Sessionspersistens**: Flikar, delningslayouter och kataloghistorik sparas automatiskt och återställs vid omstart.

### 💳 Smartcard & PKCS#11-autentisering
- **Hårdvarutokens**: Utvecklad med direkt stöd för svenska **SITHS-kort**, **Net iD**, **OpenSC** och **p11-kit**.
- **Lokal Askpass-server**: Integrerad askpass-mekanism som fångar upp OpenSSH PIN-förfrågningar och visar en säker grafisk PIN-dialog i gränssnittet.
- **Automatisk biblioteksdetektering**: Hittar installerade PKCS#11-moduler automatiskt på Linux och Windows.

### 📁 Dual-Pane Filhanterare
- **Dubbla utforskarpaneler**: Arbeta sömlöst med två paneler samtidigt mellan lokal disk, SFTP och S3.
- **Dra och släpp (Drag & Drop)**: Dra filer och mappar direkt mellan paneler eller från skrivbordet/OS-filhanteraren.
- **Bakgrundsöverföringskö**: Hanterar parallella överföringar med status, progress, paus, återuppta och avbryt.
- **Realtidsindikator för katalogskanning**: Visar omedelbar visuell feedback och räknare när stora katalogträd analyseras inför överföring.
- **Intelligent konflikthantering**: Dialog vid filkonflikter (Skriv över, Hoppa över, Byt namn med automatisk `(1)`-numrering) samt stöd för att applicera valet på alla återstående filer.
- **Rättighetseditor (chmod)**: Ändra fil- och katalogrättigheter grafiskt (läs/skriv/exekvera för User/Group/Other, oktalt format och rekursivt) för SFTP och lokal lagring.
- **Snabbsökning / Filter**: Filtrera filer och kataloger direkt i listan (`Ctrl+F`).

### ☁️ S3 & Objektlagring
- **Multi-Cloud**: Stöd för **AWS S3**, **MinIO**, **NetApp StorageGRID** och egna S3-kompatibla lagringsplattformar.
- **Avancerade anslutningar**: Anpassade endpoints, regionsval, path-style adresseringsläge, SSL-inaktivering och stöd för självsignerade certifikat (anpassad CA).

### 🔒 Nätverk, Proxies & SSH-tunnlar
- **Jump Host / ProxyJump (`-J`)**: Sömlös anslutning till servrar i isolerade nätverk genom bastionsvärdar för både Terminal och SFTP.
- **SSH-porttunnling**:
  - **Lokal port forward (`-L`)**: Tunnla lokala portar till interna fjärrtjänster (databaser, webbservrar).
  - **Fjärrport forward (`-R`)**: Exponera lokala portar på fjärrservern.
  - **Dynamisk SOCKS-proxy (`-D`)**: Skapa en lokal SOCKS5-proxy dirigerad genom SSH-anslutningen.
- **Utgående Proxy**: HTTP, SOCKS4 och SOCKS5 med stöd för proxy-autentisering.
- **Avancerade SSH-parametrar**: Konfigurera kompression (`Compression`), keep-alive (`ServerAliveInterval`) samt specifika ciphers, KEX-algoritmer och MACs för äldre eller strikta servrar.
- **Host Key-verifiering (TOFU)**: SFTP verifierar fjärrvärdens nyckel mot `~/.ssh/known_hosts` med interaktiv tillitsdialog om nyckeln ändrats.

### 📂 Profilhantering & Säkerhet
- **Mappar och grupper**: Strukturera servrar och buckets i logiska mappar med snabbfilter och antalsprofiler.
- **Senast använda**: Snabbåtkomst till de senast anslutna profilerna med tidsstämplar (`yyyy-mm-dd HH:mm`).
- **Kryptering med OS-nyckelring**: Lösenord, SSH-lösenfraser och S3-hemligheter krypteras säkert via Electrons `safeStorage` (libsecret på Linux, DPAPI på Windows, Keychain på macOS) innan de sparas.

### 🎨 Anpassning & Snabbkommandon
- **Teman**: Mörkt, ljust och automatiskt systemtema.
- **Typografi**: Anpassningsbart typsnitt och teckenstorlek för terminalen med live förhandsgranskning.
- **Kortkommandon**: Fullt anpassningsbara tangentbordsgenvägar med interaktiv inspelning och återställningsfunktion.

---

## Förvalda kortkommandon

| Kommando | Standardknapp | Beskrivning |
| :--- | :--- | :--- |
| **Ny terminal** | `Ctrl+Shift+T` | Öppnar en ny terminalflik |
| **Ny filhanterare** | `Ctrl+Shift+F` | Öppnar en ny filhanterarflik |
| **Stäng flik** | `Ctrl+W` | Stänger den aktiva fliken |
| **Nästa flik** | `Ctrl+Tab` | Bläddrar framåt bland öppna flikar |
| **Föregående flik** | `Ctrl+Shift+Tab` | Bläddrar bakåt bland öppna flikar |
| **Anslutningshanterare** | `Ctrl+Shift+O` | Öppnar profiler och anslutningar |
| **Inställningar** | `Ctrl+,` | Öppnar inställningspanelen |
| **Dela vertikalt** | `Ctrl+Shift+D` | Delar aktiv terminal i två kolumner |
| **Dela horisontellt** | `Ctrl+Shift+E` | Delar aktiv terminal i två rader |

*(Alla kortkommandon kan anpassas under Inställningar → Kortkommandon).*

---

## Installation & Nedladdning

Färdiga binärer finns tillgängliga under [GitHub Releases](https://github.com/alun-hub/sshs3/releases):

### Linux
- **AppImage**: Körbar fil utan installation. Gör filen körbar och starta:
  ```bash
  chmod +x sshs3-*.AppImage
  ./sshs3-*.AppImage
  ```
- **DEB (Debian / Ubuntu / Linux Mint)**:
  ```bash
  sudo dpkg -i sshs3_*_amd64.deb
  ```
- **RPM (Fedora / RHEL / openSUSE)**:
  ```bash
  sudo rpm -Uvh sshs3-*.x86_64.rpm
  ```

### Windows
- **NSIS Installer**: `sshs3 Setup <version>.exe` (installationsguide med skrivbordsgenväg).
- **Portabel**: `sshs3 <version>.exe` (körs direkt utan installation).

---

## Utveckling & Bygge från källkod

### Förutsättningar
- Node.js 20 eller senare
- npm 10 eller senare
- C/C++ kompilatorverktyg (för native `node-pty` / `node-gyp`)
- På Linux: `rpm` (om du ska paketera RPM-paket)

### Kom igång
```bash
# 1. Klona projektet
git clone https://github.com/alun-hub/sshs3.git
cd sshs3

# 2. Installera beroenden
npm install

# 3. Starta utvecklingsläge med hot-reload
npm run dev
```

### Tester & Kvalitetskontroll
```bash
# Typkontroll med TypeScript
npm run typecheck

# Kodstil och linter
npm run lint

# Kör alla enhetstester med Vitest
npm run test
```

### Paketera lokalt
```bash
# Bygg AppImage för Linux
npm run package:appimage

# Bygg alla Linux-paket (AppImage, deb, rpm)
npm run package:linux

# Bygg för Windows (kräver Windows-miljö)
npm run package:win
```

---

## Licens & Författare

Utvecklad av **Andreas Lundqvist** ([alun@alun.se](mailto:alun@alun.se)) — [unixkonsult.se/sshs3](https://unixkonsult.se/sshs3).
