# Terminal, Flikar & Arbetsytor

Terminalupplevelsen i **sshs3** är byggd för professionella administratörer och utvecklare som arbetar intensivt med många samtidiga sessioner och komplexa kommandon.

---

## 1. Native OpenSSH-Kärna vs. JS-Reimplementationer

Många webb- och Electron-baserade terminaler använder egna JavaScript- eller WASM-bibliotek för att hantera SSH-protokollet, vilket ofta leder till subtila buggar i terminalemulering, felaktiga radbrytningar eller bristande stöd för moderna OpenSSH-funktioner.

sshs3 kör **ditt operativsystems genuina OpenSSH-binär** (`ssh`) via `node-pty`:
- **100% kompatibilitet med `~/.ssh/config`**: Alla direktiv (`Host`, `ProxyJump`, `CertificateFile`, `SendEnv`, `IdentityFile`) fungerar exakt likadant som i ditt vanliga CLI-skal.
- **Systemets SSH-agenter**: Fungerar sömlöst med `ssh-agent`, GnuPG, 1Password och YubiKey PIV.
- **Escape-sekvenser & Färgstöd**: Fullt stöd för TrueColor (24-bitars färger), OSC-koder och musinteraktion i program som `tmux`, `vim`, `htop` och `lazygit`.

---

## 2. Terminalergonomi & Urklippshantering

### 2.1 Urklipp & Markering (Clipboard Workflow)
- **Copy on Select (Kopiera vid markering)**: När du markerar text i terminalfönstret kopieras den automatiskt till operativsystemets urklippshanterare utan att du behöver trycka något kortkommando.
- **Klistra in**:
  - Tangentbord: <kbd>Ctrl+Shift+V</kbd> (för att inte kollidera med terminalens vanliga <kbd>Ctrl+V</kbd> som skickar raw literals i bash).
  - Högerklick: Klicka med höger musknapp var som helst i terminalpanelen för att klistra in text från urklipp.
- **Högerklicksmeny (Context Menu)**:
  - *Paste*: Klistrar in text.
  - *Split Right*: Delar aktiv panel vertikalt.
  - *Split Down*: Delar aktiv panel horisontellt.
  - *Clear Buffer*: Rensar skärmen och återställer rullningsbufferten.

### 2.2 Urklippshistorik (<kbd>Ctrl+Shift+R</kbd>)
När **Copy on Select** är påslaget sparas varje markering i en krypterad, sökbar historik (OS-nyckelringen; bara i minnet om ingen nyckelring finns).
- <kbd>Shift+Insert</kbd> och mittenklick klistrar in den senaste posten.
- Högerklick eller <kbd>Ctrl+Shift+R</kbd> öppnar historiken: sök, bläddra med piltangenterna och tryck <kbd>Enter</kbd> för att klistra in.
- Omfång (alla värdar eller per anslutning) och "töm vid avslut" ställs in under Settings.

### 2.3 Sökning i Terminalens Textbuffert (<kbd>Ctrl+Shift+S</kbd>)
Tryck <kbd>Ctrl+Shift+S</kbd> för att öppna sökfältet i den fokuserade terminalpanelen:
- Söker igenom hela terminalhistoriken (upp till de rader som konfigurerats i inställningarna).
- Markerad text används som sökord. Träffräknare visar t.ex. `3/6`.
- <kbd>Enter</kbd> går till nästa träff, <kbd>Shift+Enter</kbd> till föregående, <kbd>Esc</kbd> stänger.
- Träffarna färgas efter temat (röda i Breeze, gula/orange i ljust och mörkt). Att bläddra mellan träffar kopierar inget till urklipp.

### 2.4 Klickbara länkar och filsökvägar
Håll ned <kbd>Ctrl</kbd> (<kbd>Cmd</kbd> på macOS) och klicka:
- **URL:er** (`http://`, `https://`) öppnas i standardwebbläsaren, i terminaler och Kubernetes-loggar.
- **Filsökvägar** (`/var/log/syslog`, `~/notes.md`, `/srv/app.py:42:7`) öppnar mappen i en ny SFTP-flik. Gäller SSH-terminaler. Terminalen kan inte skilja fil från mapp: en sökväg utan avslutande `/` öppnar sin föräldramapp, och `~/` antas betyda `/home/<användare>` (`/root` för root).

### 2.5 Kopiera senaste kommandots utdata (<kbd>Ctrl+Shift+G</kbd>)
Kopierar det senaste kommandots utskrift till urklipp (och till urklippshistoriken om Copy on Select är på).
- Exakt i skal som skickar OSC 133-promptmarkörer (fish, samt zsh/bash med skalintegration).
- Annars härleds utdata ur dina Enter-tryckningar. Med en flerradig prompt kan promptens första rad följa med.

### 2.6 Snippets (<kbd>Ctrl+Shift+L</kbd>)
En sökbar palett med sparade kommandon:
- <kbd>Enter</kbd> skriver in kommandot, <kbd>Ctrl+Enter</kbd> skriver in och kör det. Flerradiga snippets klistras in som en paste.
- **New** skapar ett snippet; penna och papperskorg redigerar och tar bort. Ett snippet kan begränsas till den aktuella anslutningen.
- Variabler: `{{host}}`, `{{user}}`, `{{date}}` (format `yyyy-mm-dd HH:mm`).
- Snippets sparas **okrypterat** i `snippets.json` i appens datamapp. Lägg aldrig lösenord eller tokens i dem.

### 2.7 Dynamisk Textskalning (Zoom)
Under presentationer, möten eller vid arbete på högupplösta 4K-skärmar kan teckenstorleken skalas ögonblickligen:
- <kbd>Ctrl++</kbd>: Ökar teckenstorleken med 1 px.
- <kbd>Ctrl+-</kbd>: Minskar teckenstorleken med 1 px.
- <kbd>Ctrl+0</kbd>: Återställer teckenstorleken till standardvärdet från inställningarna.

---

## 3. Konsole-Style Rekursiva Split-Paneler

sshs3 implementerar samma split-träd-arkitektur som KDE:s Konsole (`ViewSplitter`), vilket möjliggör obegränsad horisontell och vertikal uppdelning:

![Split Paneler i Terminalen](/img/split-terminal.png)

### 3.1 Navigering & Storleksändring
- **Dra i delningsbalkarna**: Placera muspekaren mellan två paneler för att dra och anpassa panelernas bredd och höjd.
- **Tangentbordsnavigering**:
  - <kbd>Ctrl+Shift+N</kbd>: Flyttar fokus till **nästa panel** i trädet.
  - <kbd>Ctrl+Shift+P</kbd>: Flyttar fokus till **föregående panel**.
- **Paneloberoende**:
  - Varje panel har en egen miniverktygsrad och anslutningsväljare. Du kan ha en fjärr-SSH-session i vänstra panelen, ett lokalt bash-skal i den övre högra och en Kubernetes container exec i den nedre högra.
  - Att stänga en panel (<kbd>Ctrl+Shift+W</kbd>) avbryter aldrig intilliggande sessioner; trädet kollapsar mjukt och ger utrymme till de återstående panelerna.
- **Unsplit**: Klicka på unsplit-ikonen i panelens verktygsrad för att maximera den aktiva panelen till 100% och stänga alla andra split-paneler i fliken.

---

## 4. Sessionsbeständighet (Session Persistence)

När du stänger sshs3 sparas din aktuella arbetsyta automatiskt:
- Alla öppna flikar och deras split-panellayouter bevaras.
- Arbetskataloger för lokala skal återställs vid nästa start.
- Om applikationen startas om efter en mjukvaruuppdatering öppnas dina fönster och anslutningar i exakt samma tillstånd.
