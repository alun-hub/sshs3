# Performance Bar & Diagnostik (Senior UX & SRE Guide)

**Performance Bar** är en strömlinjeformad, realtidsuppdaterad telemetrilist som sitter direkt ovanför aktiva SSH-, lokala skal- och Kubernetes-terminaler i **sshs3**. Den ger ögonblicklig insyn i maskinens hälsotillstånd utan att belasta servern eller kräva externa övervakningsagenter.

---

## 1. Live Telemetribalk i Terminalen

Här ser du den aktiva prestandabalken direkt i toppen av en terminalsession:

![Live Performance Bar](/img/docs/terminal-metrics.png)

> [!NOTE]
> **Opt-in som standard**: Prestandabalken är avstängd som standard för att garantera absolut noll oönskad bakgrundstrafik eller resursanvändning. Aktivera den under **Settings → Performance**.

---

## 2. Hur Provtagningen Fungerar (Noll Extra Inloggningar)

### 2.1 SSH över OpenSSH ControlMaster (Linux)
Telemetrin samplas direkt över den **redan etablerade ControlMaster-socketen**:
- **Inga extra inloggningar**: Reanvänder befintlig kryptografisk tunnel; kräver aldrig något nytt lösenord, ingen ny lösenfras, och **ingen extra PIN-kod eller beröring av hårdvarunycklar (FIDO2/YubiKey)**.
- **Säkerhetsgaranti via `BatchMode=yes`**: Varje mätpunkt kör ett enda skrivskyddat bash-skript som läser direkt från `/proc`. Flaggan `BatchMode=yes` garanterar att kommandot omedelbart avbryts om anslutningen mot förmodan skulle försöka fråga efter auth.

### 2.2 Windows SSH-begränsningar & Fallback
Windows OpenSSH stöder inte UNIX-domänsocketer för ControlMaster. På Windows använder sshs3 därför en kortlivad, icke-interaktiv `ssh`-anslutning i bakgrunden:
- Begränsat till nyckel- och agentbaserade inloggningar (lösenordsprofiler utan sparat lösenord i Keychain hoppas över för att undvika promptar).
- Provtagningsintervallet på Windows är begränsat till minst var 10:e sekund för att undvika onödig processtart. Svarstiden ("Ping") mäts som TCP connect-tid mot port 22.

### 2.3 Kubernetes Poddar & Containrar
Läser direkt från `metrics.k8s.io`-API:et (motsvarande `kubectl top pod`):
- Mäter CPU och minne per container relativt dess konfigurerade **requests** och **limits**.
- Kräver att klustret har `metrics-server` installerat. Pollingintervallet är begränsat till minst 10s eftersom metrics-server i Kubernetes uppdateras var 15–60:e sekund.

---

## 3. Detaljerad 15-Minuters Diagnostikmodal

Klicka var som helst på prestandabalken för att öppna den djupgående diagnostikmodalen:

![Performance Diagnostics Modal](/img/docs/performance-detail.png)

---

## 4. Senior SRE/DevOps Guide: Hur Mätvärdena Ska Tolkas

Som systemadministratör eller DevOps-ingenjör är råa procentsatser sällan tillräckliga. Här förklaras hur du tolkar de specifika mätvärdena i sshs3:

### 4.1 CPU-fördelning: User+System vs. I/O-wait vs. Steal
Donut-diagrammet för CPU delar upp processorns tid i fyra kritiska komponenter:
1. **User + System (Aktiv beräkning)**:
   - Den tid processorn utför faktiska instruktioner (användarprogram eller kärnan).
2. **I/O Wait (`iowait`) — Kritiskt flaskhalsmått**:
   - Den tid processorn är sysslolös men **väntar på att pågående diskoperationer ska slutföras**.
   - *Tolkning*: Om CPU-användningen verkar låg (t.ex. 25%) men `iowait` ligger på 60–70%, lider servern av en **disk- eller I/O-flaskhals** (t.ex. för långsam EBS-volym på AWS, mättad databasdisk eller intensiv swap-aktivitet), inte brist på CPU-kapacitet.
3. **Steal (`steal`) — Molngranne-varning ("Noisy Neighbors")**:
   - Den tid då den virtuella maskinens processor var redo att köra, men hypervisorn i molnet (AWS EC2, GCP, Azure, Proxmox) tog CPU-cykler till andra gäster på samma fysiska hårdvara.
   - *Tolkning*: En `steal` över 5–10% betyder att din molninstans är överbelagd eller att grannmaskiner på samma fysiska värddator stjäl CPU-kapacitet.

---

### 4.2 Minne: Used vs. Buffers/Cache vs. Free
Många utvecklare drabbas av panik när de ser 95% minnesanvändning i Linux:
- **Sidcache (`page cache`) & Buffertar**: Linux låter aldrig RAM-minne stå tomt och oanvänt. Ledigt minne allokeras automatiskt för att cacha lästa diskblock. Om ett program plötsligt behöver minne frigörs sidcachen ögonblickligen.
- **sshs3 visualisering**: Donut-diagrammet visar exakt hur mycket som är *faktiskt låst av applikationer* (`Used`) kontra vad som är *återkallningsbar cache* (`Cache/Buffers`) och helt ledigt (`Free`).

---

### 4.3 Load Average vs. Core Count (Kärnnormalisering)
- Råa load-siffror (t.ex. `Load: 4.2`) är meningslösa utan vetskap om antalet CPU-kärnor.
- På en **8-kärnig server** innebär Load 4.0 att maskinen är belastad till **50%**.
- På en **2-kärnig server** innebär Load 4.0 att maskinen är överbelastad till **200%** och att processer köar i vänteläge.
- sshs3 visar alltid Load i relation till serverns faktiska kärnantal.

---

### 4.4 Kubernetes Pod Limits: Skydd mot OOMKilled (Exit Code 137)
När en container närmar sig sin minnesgräns (`limits.memory`) ingriper Linux kernel OOM Killer och terminerar containern med `Exit Code 137`.
- I prestandabalken och historikmodalen visualiseras containeranvändningen som färgade mätbalkar relativt **både request och limit**.
- Detta gör att du kan upptäcka minnesläckor långt innan containern kraschar och går in i `CrashLoopBackOff`.
