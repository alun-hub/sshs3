# Dual-Pane File Manager (Komplett Referenshandbok)

Filhanteraren i **sshs3** erbjuder en integrerad tvåpanelsutforskare för att överföra och hantera filer sömlöst mellan lokal disk, fjärranslutna SFTP-servrar, Amazon S3-kompatibla molnbuckets och Kubernetes-containrar.

![Dual-Pane File Manager](/img/filemanager.png)

---

## 1. Arkitektur & SFTP v3 Motor

### 1.1 SFTP över Systemets OpenSSH-binär
sshs3 använder en egenutvecklad SFTP v3-protokollmotor som körs direkt över ditt operativsystems `ssh`-binär (`ssh -s sftp`):
- **Återanvänder alla OpenSSH-konfigurationer**: Dina SSH-nycklar, lösenfraser, `~/.ssh/config`-inställningar, ProxyJump-bastioner och smartcard-agenter används automatiskt utan att behöva konfigureras separat.
- **Prestanda & Säkerhet**: Motorn har en inbyggd säkerhetsspärr på **16 MB paketlängd** för att skydda mot minnesläckor eller felaktiga servrar, samt optimerad samtidig byte-chunking för höghastighetsöverföring av filer i gigabyte-klassen.

---

## 2. Tvåpanelslayout & Protokolloberoende Överföringar

Filhanteraren har två oberoende paneler (Vänster och Höger). Varje panel kan fritt kopplas till vilket protokoll som helst:
- **Lokal maskin**: Din lokala arbetsstations filsystem.
- **SFTP-server**: Fjärrvärdar via SSH.
- **S3 Object Storage**: AWS S3, Cloudflare R2, MinIO, Wasabi m.fl.
- **Kubernetes Pod**: Containerns filsystem i realtid.

### 2.1 Överföringsvägar
- **Lokal ↔ SFTP**
- **SFTP ↔ SFTP** (Direkt överföring mellan två olika fjärrservrar)
- **Lokal ↔ S3**
- **SFTP ↔ S3** (Ladda upp direkt från en Linux-server till en S3-bucket utan att först mellanlanda på din lokala dator)
- **Lokal / SFTP / S3 ↔ Kubernetes Pod**

---

## 3. Funktioner & Detaljerad Användning

### 3.1 Dra-och-Släpp & Överföringskö (Transfer Queue)
- **Dra-och-släpp**: Markera en eller flera filer och dra dem från ena panelen till den andra.
- **Överföringskön**: Visas i en utfällbar list längst ner i fönstret:
  - Visar aktuell överföringshastighet (KB/s eller MB/s), förfluten tid och beräknad återstående tid (ETA).
  - Stöder paus, återuppta och avbrytning av enskilda jobb eller hela kön.
  - Samtidiga jobb konfigureras i inställningarna (standard: 3 parallella strömmar).

### 3.2 Konflikthantering vid Filkollisioner
När en fil med samma namn redan finns i målkatalogen öppnas konfliktfönstret:
- **Overwrite**: Skriver över den befintliga filen.
- **Skip**: Hoppar över filen och fortsätter med nästa i kön.
- **Resume**: Återupptar en avbruten överföring genom att fortsätta skriva från sista kända byten (stöds på SFTP och lokal disk).
- **Rename**: Sparar filen med ett automatiskt tillägg (t.ex. `rapport_copy(1).pdf`).
- **Apply to all**: Applicerar samma val på alla efterföljande filkonflikter i den aktuella överföringsbatchen.

---

### 3.2b Tangentbordsnavigering
<kbd>Ctrl+Shift+←</kbd>/<kbd>→</kbd> växlar mellan vänster och höger panel, <kbd>↑</kbd> går till flikfältet och <kbd>↓</kbd> tillbaka till den aktiva panelens fillista. I listan flyttar <kbd>↑</kbd>/<kbd>↓</kbd> markeringen, <kbd>Enter</kbd> öppnar mappen eller filen (fokus stannar kvar i listan) och <kbd>Escape</kbd> rensar markeringen.

### 3.3 Rekursiv Filsökning & Jokertecken (<kbd>Ctrl+F</kbd>)
Tryck <kbd>Ctrl+F</kbd> i valfri panel för att öppna sökfältet:

- **Lokal mappfiltrering**: Filtrerar omedelbart filerna i den aktuella mappen.
- **Kryssrutan "Recursive"**:
  Traverserar undermappar nedåt i filträdet:
  - Begränsat till max **1 000 träffar över 3 000 mappar** för att skydda minnet och undvika API-blockeringar.
  - Träfflistan visar filernas relativa sökväg och låter dig öppna, kopiera eller överföra dem som vanliga filer.
  - **Loop-skydd**: Symboliska länkar (symlinks) till mappar ignoreras automatiskt under rekursion för att förhindra oändliga loopar.
  - Dolda mappar hoppas över såvida inte "Show Hidden Files" är påslaget.
- **Jokertecken (`*` och `?`)**:
  - `*.log`: Matchar alla filer som slutar på `.log`.
  - `config-?.json`: Matchar enskilda variabla tecken.
  - Text utan jokertecken tolkas som skiftlägesokänslig delsträngssökning.

---

### 3.4 Inbyggd Texteditor
Dubbelklicka eller högerklicka på valfri textfil, skript eller YAML-manifest och välj **Edit**:
- En enkel textredigerare utan syntaxfärgning. Vill du ha din egen editor finns överlämning till en extern editor.
- **Spara direkt mot fjärrservern**: Tryck <kbd>Ctrl+S</kbd> för att skriva ändringarna direkt tillbaka till SFTP-servern, S3-objektet eller containern.
- Inbyggd **Markdown Live Preview** med omkopplaren **Source | Preview**.
- **Live Log Tail**: följ en växande loggfil (`tail -f`) i samma vy, med paus, återuppta och sök.

---

### 3.5 Directory Sync (Katalogjämförelse & Synkronisering)
Klicka på **Sync Directories** i verktygsfältet för att jämföra två kataloger:
- **Visuell Färgkodad Diff**:
  - Grön: Nya filer som saknas på målet.
  - Blå: Modifierade filer (upptäcks via storleksskillnad och nyare tidsstämpel).
  - Röd: Filer som endast existerar på målet.
- **Synkroniseringslägen**:
  - *One-Way (Spegling)*: Målet görs till en exakt kopia av källan.
  - *Update Existing Only*: Endast filer som redan finns på målet uppdateras.
  - *Two-Way*: Nya och ändrade filer kopieras i båda riktningarna.
- **Spara Profiler**: Spara återkommande synkroniseringsjobb för backup eller deployment.

---

### 3.6 Behörigheter & Chmod
Högerklicka på valfri fil eller mapp och välj **Permissions**:
- Visuell matris för **Read**, **Write** och **Execute** för User, Group och Others.
- Direkt inmatning av oktala behörighetsvärden (t.ex. `0755`, `0644`, `0700`).
- **Recursive Chmod**: Applicera behörigheterna rekursivt på alla undermappar och filer med ett klick.

---

### 3.7 Git-integration & Fjärrhantering (SFTP & Lokal)
Filhanteraren känner automatiskt av om en öppnad mapp är ett Git-repositorium (både lokalt och på fjärrservrar över SFTP via SSH):
- **Gren- & Statusindikator i Verktygsfältet**:
  - Visar aktuell gren (t.ex. `main`).
  - Visar om det finns osparade ändringar (`*` och antal modifierade/ospårade filer i detaljvyn).
  - Visar antal commits före (`↑ ahead`) eller efter (`↓ behind`) fjärr-repot (`origin`).
- **Git-meny & Snabbkommandon**:
  - **Git Pull**: Uppdatera repot direkt med ett klick utan att behöva öppna en terminal.
  - **Open in GitHub/GitLab**: Öppnar repositoriets webbsida direkt i standardwebbläsaren om ett fjärr-repo (`remote.origin.url`) finns konfigurerat.
  - **Clone Git repository here...**: Klona ett nytt git-arkiv till den aktuella mappen.
- **Kontextmenyåtgärder**:
  - Högerklicka på en undermapp för att välja **Git Clone inside...**.
  - Högerklicka på en tom yta för att välja **Git Clone to here...**, **Git Pull** eller **Open in GitHub/GitLab**.
- **Slå på / stänga av**:
  - Git-integrationen kan slås på och av under **Settings > Git & GitHub** (*SFTP & File Manager Git Integration*). När den stängs av sker ingen git-polling i bakgrunden och verktygsfältet och kontextmenyn hålls helt rena från git-element.

