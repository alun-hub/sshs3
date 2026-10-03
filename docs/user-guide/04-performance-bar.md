# Performance Bar (Opt-In Live Metrics)

**Performance Bar** är en strömlinjeformad telemetrilist som sitter direkt ovanför aktiva SSH-, lokala skal- och Kubernetes-terminaler i **sshs3**. Den ger ögonblicklig insyn i systemresurser och prestanda utan externa övervakningsagenter.

![Prestandainställningar](/img/docs/settings-performance.png)

> [!NOTE]
> Prestandabalken är **opt-in och avstängd som standard** för att garantera absolut noll oönskad bakgrundstrafik eller resursanvändning. Aktivera den under **Settings → Performance**.

---

## 1. Hur Provtagningen Fungerar (Noll Extra Inloggningar)

### 1.1 Fjärranslutna SSH-sessioner (Linux)
Telemetri samplas direkt över den **redan öppna OpenSSH ControlMaster-socketen**:
- **Inga extra inloggningar**: Eftersom ControlMaster-kanalen återanvänds krävs inget nytt lösenord, ingen ny lösenfras, och ingen extra PIN-kod eller beröring av hårdvarunycklar (FIDO2/YubiKey).
- **Stenhård Säkerhet**: Varje mätpunkt kör ett enda skrivskyddat bash-skript som läser direkt från `/proc`. Skriptet körs med `BatchMode=yes`, vilket garanterar att kommandot omedelbart avbryts om anslutningen mot förmodan skulle försöka fråga efter autentisering.
- **Vad som mäts**:
  - **CPU**: Total processorbelastning samt per-kärna belastning.
  - **Minne (RAM)**: Använt minne, ledigt minne, buffertar och sidcache (`page cache`).
  - **Load Average**: 1-, 5- och 15-minuters snitt normaliserat mot antalet tillgängliga CPU-kärnor.
  - **Swap**: Använd och total swap.
  - **Disk**: Rotkatalogen (`/`) samt alla monterade filsystem.
  - **Nätverk**: Nedladdnings- och uppladdningshastighet (↓ / ↑ i KB/s eller MB/s).
  - **Disk I/O**: Läs- och skrivhastighet mot diskenheter.
  - **Kärnvärden**: `iowait` (tid processorn väntar på disk), `steal` (tid stulen av hypervisorn), processantal och drifttid (`uptime`).
  - **Latens / Ping**: TCP-svarstid fram och tillbaka till servern.

### 1.2 Windows SSH-begränsningar & Fallback
- **Bakgrund**: Windows OpenSSH har inte stöd för UNIX-domänsocketer för ControlMaster.
- **Hur sshs3 löser det**: På Windows använder varje mätning en kortlivad, icke-interaktiv `ssh`-anslutning i bakgrunden.
- **Begränsning**: Denna provtagning är strikt begränsad till nyckel- och agentbaserade inloggningar. Profiler som endast har interaktivt lösenord utan sparat lösenord i Keychain kan inte samplas på Windows (för att aldrig visa oväntade lösenordsfönster). Provtagningsintervallet på Windows är spärrat till minst var 10:e sekund för att minimera processhantering. Svarstiden ("Ping") mäts som TCP connect-tid mot SSH-porten.

### 1.3 Lokalt Skal (Workstation)
- **Linux**: Full uppsättning telemetrimätningar direkt från din egen maskins `/proc`.
- **Windows & macOS**: CPU (totalt och per kärna), RAM, drifttid och diskutrymme (samt load average på macOS).

### 1.4 Kubernetes Poddar & Containrar
- **Metod**: Läser direkt från `metrics.k8s.io`-API:et via appens inbyggda Kubernetes-klient (motsvarande `kubectl top pod`).
- **Mätvärden**: CPU och minne per container beräknat mot containerns konfigurerade **requests** och **limits**.
- **Statusvärden**: Antal omstarter (`restarts`), Ready-status, poddålder och nodtilldelning.
- **Begränsning**: Klustret måste ha `metrics-server` installerat. Om metrics-server saknas visas texten *"metrics-server not available"*. Uppdateringsfrekvensen begränsas till minst 10s eftersom metrics-server i Kubernetes endast uppdateras var 15–60:e sekund.

---

## 2. Visningslägen & Diagnostik

Prestandabalken stöder tre visuella lägen konfigurerade i **Settings → Performance**:

1. **Compact Text**: Rena textvärden, perfekt vid delade skärmar och många öppna paneler.
2. **Bars (Färgkodade mätare)**: Grafiska mätbalkar som övergår från grönt till gult och rött vid hög belastning.
3. **Mini Sparklines**: Rullande miniatyrgrafer som visualiserar trender och tillfälliga toppar i realtid.

### 2.1 Hover-tooltip med Samtliga Mätvärden
Håll muspekaren över prestandabalken för att omedelbart visa en flytande tooltip med **alla tillgängliga mätvärden** för den sessionen, även de mätvärden du inte valt att visa i själva listen.

### 2.2 15-Minuters Diagnostikhistorik (Klicka på balken)
Klicka var som helst på prestandabalken för att öppna den detaljerade **Performance Diagnostics Modalen**:
- **Linjediagram**: Detaljerade tidsseriegrafer över de senaste 15 minuternas historik för CPU, minne, swap, nätverk och disk I/O.
- **Donut-grafer**:
  - *CPU Time*: Fördelning mellan User+System, I/O Wait, Steal och Idle.
  - *Minnesfördelning*: Fördelning mellan faktiskt använt, buffertar/cache och ledigt minne.
- **Per-Filsystem Diskstaplar**: Kapacitetsmätare för varje monterad diskpartition.
- **Request & Limit Staplar för Poddar**: Omedelbar visuell varning om en container närmar sig sin OOMKill-gräns.
- Historiken bevaras under hela tiden fliken är öppen och överlever flikbyten.
