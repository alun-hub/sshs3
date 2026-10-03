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

### 2.2 Sökning i Terminalens Textbuffert (<kbd>Ctrl+Shift+F</kbd>)
Tryck <kbd>Ctrl+Shift+F</kbd> för att öppna sökfältet i den aktiva terminalpanelen:
- Söker igenom hela terminalhistoriken (upp till de 5 000 rader som konfigurerats i inställningarna).
- Navigera mellan träffar med piltangenterna eller <kbd>Enter</kbd>.
- Perfekt för att lokalisera specifika felkoder, stack traces eller IP-adresser i långa loggutskrifter.

### 2.3 Dynamisk Textskalning (Zoom)
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
