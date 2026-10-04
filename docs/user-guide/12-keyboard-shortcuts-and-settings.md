# Inställningar & Tangentbordsgenvägar (Komplett Referenshandbok)

Detta kapitel innehåller en fullständig genomgång av samtliga inställningsflikar i sshs3, hur de konfigureras, deras tekniska begränsningar samt en komplett referenstabell över alla kortkommandon i applikationen.

---

## 1. Globala Inställningar (Settings Modal)

Öppna inställningsfönstret via kugghjulsikonen i det övre verktygsfältet eller med snabbkommandot <kbd>Ctrl+,</kbd>.

![Inställningsöversikt](/img/docs/settings-overview.png)

Inställningarna är indelade i sju specialiserade paneler:

---

### 1.1 General & Appearance (Allmänt & Utseende)
- **Tema (Theme)**: Välj mellan **Dark** (standard mörkt slate-tema), **Light** (ljust grått tema), **Breeze** (KDE-inspirerat tema med cyan-detaljer), eller **System** (följer operativsystemets mörka/ljusa läge).
- **Confirm Before Quit**: Om detta är aktiverat varnar appen om du försöker stänga fönstret medan du har aktiva terminalsessioner eller pågående filöverföringar i bakgrunden.
- **Automatic Updates**: Slår på eller av automatisk bakgrundskontroll mot GitHub Releases var 6:e timme.
  > [!NOTE]
  > **Air-Gap Switch**: Sätt miljövariabeln `SSHS3_DISABLE_UPDATES=1` i operativsystemet för att helt låsa denna inställning och stänga av all nätverkstrafik för uppdateringar.

---

### 1.2 Terminal
![Terminalinställningar](/img/docs/settings-terminal.png)

| Inställning | Standardvärde | Syfte & Beskrivning | Begränsningar |
| :--- | :--- | :--- | :--- |
| **Font Family** | Monospace-stack (välj förinställning eller egen) | Typsnittet som används för att rendera text och symboler i terminalen. | Kräver ett monospaced (fast teckenbredd) typsnitt. Proportionella typsnitt gör att markörpositioner förskjuts. |
| **Font Size** | `13 px` | Grundstorleken för text i terminalpaneler. | Kan justeras dynamiskt per flik med <kbd>Ctrl++</kbd> och <kbd>Ctrl+-</kbd>. |
| **Cursor Style** | `Block` | Markörens utseende: **Block**, **Underline** (understreck) eller **Bar** (vertikal linje). | Visas i aktiv panel. |
| **Scrollback Buffer** | `5000 rader` | Hur många rader historik som bevaras i minnet för varje terminalpanel. | Högre värden (t.ex. 50 000 rader) använder mer RAM-minne per öppen panel. |
| **Copy text automatically on selection** | `Av` | Kopierar varje markering till urklipp och sparar den i den krypterade urklippshistoriken. | Historiken kräver OS-nyckelring för att sparas på disk, annars bara i minnet. |
| **Clipboard history scope** | `Global` | Delad historik för alla värdar, eller separat historik per anslutning. | Gäller bara när Copy on Select är på. |
| **Empty clipboard history on exit** | `Av` | Tömmer urklippshistoriken när appen avslutas (och vid nästa start om den kraschade). | |
| **On Logout / Session End** | `Reconnect` | Vad som händer när en session avslutas: återanslut, stäng fliken eller behåll den. | |

---

### 1.3 Performance (Prestandabalken)
![Prestandainställningar](/img/docs/settings-performance.png)

- **Enable Performance Bar**: Slår på eller av den direktsända telemetribalken ovanför terminalerna. (Avstängd som standard för att garantera noll overhead).
- **Layout Mode**:
  - `Compact Text`: Rena textvärden (t.ex. `CPU: 12% | RAM: 3.4/16 GB | Ping: 14ms`).
  - `Bars`: Färgkodade mätbalkar som ändrar färg dynamiskt från grönt till gult och rött vid hög belastning.
  - `Sparklines`: Miniatyrdiagram i realtid som visar de senaste mätpunkterna som linjegrafer.
- **Sampling Interval**: Välj uppdateringsintervall: `2s`, `5s`, `10s` eller `30s`. På Windows begränsas intervallet automatiskt till minst 10s för att undvika onödig TCP-trafik.
- **Mätvärdesurval**: Bocka för exakt vilka parametrar som ska visas i listen: CPU, minne, load, swap, nätverk in/ut, disk I/O, iowait, steal, processantal, per-kärna CPU och latens/ping.

---

### 1.4 Files & Storage (Filhanteraren)
![Filhanterarens inställningar](/img/docs/settings-files.png)

- **Show Hidden Files**: Visa eller dölj filer och mappar som börjar med en punkt (`.`).
- **Concurrent Transfers**: Antal samtidiga filöverföringsjobb i överföringskön (standard: 3). Högre värden ger snabbare överföring av många småfiler, men kan mätta nätverket.
- **Default Conflict Action**: Standardåtgärd vid filkollisioner: **Ask** (fråga varje gång), **Overwrite** (skriv över), **Skip** (hoppa över) eller **Resume** (återuppta).
- **Preserve Timestamps**: Bevarar ursprungliga ändringstidsstämplar (`mtime`) på filer vid ned- och uppladdning (stöds över SFTP och lokal disk).

---

### 1.5 Synchronization (Fjärrsynkronisering & Dotfiles)
![Synkroniseringsinställningar](/img/docs/settings-sync.png)

- **Remote Profile Sync ("Own Your Data")**:
  - Synkroniserar dina krypterade profiler mot din egen S3-bucket eller privata SSH-server.
  - All data krypteras lokalt på din maskin med **AES-256-GCM** innan den lämnar datorn.
  - Konfigurera synktarget och huvudlösenord för valvet.
- **Dotfiles Pool Manager**:
  - Hantera din samling av gemensamma `.bashrc`, `.vimrc`, skript och profilfiler som kan laddas upp temporärt vid inloggning på valfria servrar.

---

### 1.6 Security & Smartcard (Säkerhet & Hårdvarunycklar)
![Säkerhetsinställningar](/img/docs/settings-security.png)

- **PIN Caching Policy**:
  - `Per-Session (Standard)`: Frågar efter PIN-kod vid anslutning och behåller den i flyktigt minne endast under handskakningen.
  - `Global (App Lifetime)`: Cachas säkert i appens minne under hela appens körtid. Nya flikar, split-paneler och SFTP-sessioner återanvänder samma upplåsta kort utan nya promptar. Raderas omedelbart vid avslut.
  - `Never`: Frågar efter PIN-kod vid precis varje enskild kryptografisk signering.
- **Preferred PKCS#11 Library**: Välj vilket bibliotek som ska prioriteras vid autoupptäckt: `p11-kit` (standard), `YubiKey libykcs11`, `OpenSC` eller `Net iD`.
- **Master Password Vault**: Fallback-kryptering med AES-256-GCM om operativsystemets inbyggda nyckelring (Secret Service / DPAPI) inte är tillgänglig.

---

### 1.7 Git & GitHub (Utvecklarnycklar & Git-konfiguration)
Centraliserad instrumentpanel för utvecklarnycklar, Git-leverantörer och kryptografisk commit-signering:

- **Developer SSH Keys & Git Providers**:
  - Samlar alla upptäckta publika nycklar från `~/.ssh`, operativsystemets aktiva SSH-agent samt den globala smartcard-cachen (YubiKey/PIV/FIDO2).
  - **Copy**: Kopierar den publika nyckelsträngen direkt till urklipp.
  - **GitHub / GitLab**: Öppnar respektive leverantörs SSH-nyckelinställningar i webbläsaren med nyckelnamnet ifyllt och kopierar automatiskt nyckeltexten till urklipp så att den är redo att klistras in (<kbd>Ctrl+V</kbd>).
  - **Sign Active / Git Sign**: Väljer och konfigurerar den valda nyckeln som aktiv signeringsnyckel i `~/.gitconfig` med ett enda klick.
- **Git Commit Signing (`~/.gitconfig`)**:
  - Visar aktivt signeringsformat (`ssh`) och aktiv publik nyckel.
  - **Automatic Signing (`commit.gpgsign`)**: Slå på eller av global automatisk signering av alla commits.
  - **allowed_signers**: Uppdaterar automatiskt `~/.ssh/allowed_signers` så att lokala signaturer kan verifieras utan felmeddelanden.
  - **Change Key / Custom Key**: Möjlighet att manuellt klistra in valfri SSH-publiknyckel eller nyckelsökväg.
- **SFTP & File Manager Git Integration**:
  - Reglage för att aktivera eller inaktivera Git-integrationen i filhanteraren (standard: påslagen).
  - När den är avstängd utförs ingen bakgrundspolling av git-status över SFTP eller lokala mappar, och verktygsfältet hålls rent.
- **Lookup Public Keys (`username.keys`)**:
  - Slå upp och inspektera publika nycklar för valfritt användarnamn på GitHub, GitLab eller privat GitLab-instans via deras officiella `.keys`-slutpunkter.

---

## 2. Komplett Referenstabell över Tangentbordsgenvägar

![Kortkommandon](/img/docs/settings-shortcuts.png)

### Terminal & Paneler (Split-Panes)

| Genväg | Åtgärd | Beskrivning |
| :--- | :--- | :--- |
| <kbd>Ctrl+Shift+D</kbd> | **Dela Vertikalt (Höger)** | Delar aktiv panel på mitten och placerar en ny panel till höger. |
| <kbd>Ctrl+Shift+E</kbd> | **Dela Horisontellt (Ner)** | Delar aktiv panel på mitten och placerar en ny panel nedanför. |
| <kbd>Ctrl+Shift+N</kbd> | **Nästa Panel** | Flyttar tangentbordsfokus framåt till nästa panel i trädet. |
| <kbd>Ctrl+Shift+P</kbd> | **Föregående Panel** | Flyttar tangentbordsfokus bakåt till föregående panel. |
| <kbd>Ctrl+Shift+T</kbd> | **Ny Terminal** | Öppnar en ny terminalflik. |
| <kbd>Ctrl+Shift+F</kbd> | **Ny Filhanterare** | Öppnar en ny filhanterarflik. |
| <kbd>Ctrl+Shift+O</kbd> | **Connection Manager** | Öppnar sparade profiler och anslutningar. |
| <kbd>Ctrl+W</kbd> | **Stäng Flik** | Stänger hela den aktiva fliken och alla dess split-paneler. |
| <kbd>Ctrl+Tab</kbd> | **Nästa Flik** | Växlar till nästa öppna flik. |
| <kbd>Ctrl+Shift+Tab</kbd> | **Föregående Flik** | Växlar till föregående öppen flik. |
| <kbd>Ctrl+Shift+S</kbd> | **Sök i Terminal** | Öppnar sökfältet för att söka i terminalens textbuffert. |
| <kbd>Ctrl+Shift+R</kbd> | **Urklippshistorik** | Öppnar den krypterade historiken över terminalmarkeringar (kräver Copy on Select). |
| <kbd>Ctrl+Shift+G</kbd> | **Kopiera Senaste Utdata** | Kopierar det senaste kommandots utskrift. |
| <kbd>Ctrl+Shift+L</kbd> | **Snippets** | Öppnar paletten med sparade kommandon. |
| <kbd>Ctrl++</kbd> | **Zooma In** | Ökar teckenstorleken i den aktiva terminalen. |
| <kbd>Ctrl+-</kbd> | **Zooma Ut** | Minskar teckenstorleken i den aktiva terminalen. |
| <kbd>Ctrl+0</kbd> | **Återställ Zoom** | Återställer teckenstorleken till standardvärdet. |

### Filhanteraren

| Genväg | Åtgärd | Beskrivning |
| :--- | :--- | :--- |
| <kbd>Ctrl+F</kbd> | **Sök Filer** | Öppnar filfilteringslisten i aktiv panel. Stöder rekursiv sökning och jokertecken (`*`, `?`). |
| <kbd>F5</kbd> / <kbd>Ctrl+R</kbd> | **Uppdatera** | Läser in innehållet i den aktiva katalogen på nytt. |
| <kbd>Ctrl+S</kbd> | **Spara Fjärrfil** | I den inbyggda Monaco-editorn: sparar ändringarna direkt tillbaka till servern. |
| <kbd>Delete</kbd> | **Ta Bort** | Raderar markerade filer eller mappar efter bekräftelse. |
| <kbd>F2</kbd> | **Byt Namn** | Byt namn på den markerade filen. |

### Globala Applikationskommandon

| Genväg | Åtgärd | Beskrivning |
| :--- | :--- | :--- |
| <kbd>Ctrl+Shift+K</kbd> | **Sök i Filer** | Innehållssökning över lokal disk, SFTP och S3. |
| <kbd>Ctrl+,</kbd> | **Inställningar** | Öppnar inställningsdialogen. |
| <kbd>Ctrl+Q</kbd> | **Avsluta sshs3** | Stänger applikationen (kontrollerar aktiva överföringar först). |
