# Kubernetes & OpenShift Workloads (Komplett Referenshandbok)

**sshs3** tillhandahåller en inbyggd och säker miljö för att inspektera, felsöka och hantera Kubernetes- och OpenShift-kluster direkt vid sidan av SSH-, SFTP- och S3-arbetsflöden. Inga externa tillägg eller agenter krävs i klustret.

---

## 1. Arkitektur & Säkerhet (Zero-Agent)

sshs3 kommunicerar direkt med standard **Kubernetes API** med hjälp av uppgifterna i din lokala `~/.kube/config` (eller via OpenShift `oc login` token-autentisering):

![Kubernetes Klustervy](/img/docs/k8s-clusters-view.png)

### 1.1 Klusterupptäckt & Lazy Loading
- **Automatisk Upptäckt**: Vid start läser appen automatiskt av alla kontexter i `~/.kube/config`.
- **Live File Watcher**: En filbevakare (`fs.watch`) lyssnar på ändringar i din kubeconfig-fil. Om du byter aktiv kontext i terminalen (`kubectl config use-context`) eller loggar in på ett nytt kluster via CLI uppdateras trädet i sshs3 ögonblickligen utan omstart.
- **Resilient Lazy Loading**: Kontexter, namnrymder och poddar anropas asynkront endast när du klickar för att expandera en gren. Om ett kluster är offline eller bakom en stängd VPN-tunnel låser det aldrig gränssnittet eller fördröjer appens uppstart.

---

## 2. Funktioner & Detaljerad Användning

### 2.1 Interaktiv Container Exec Terminal (`tty`)
- **Syfte**: Öppna ett interaktivt skal rakt in i en körande applikationscontainer för omedelbar felsökning.
- **Hur den används**:
  1. Expandera ditt kluster → Kontext → Namnrymd → Pod.
  2. Klicka på containern och välj **Exec Terminal** (eller högerklicka och välj *Exec Shell*).
  3. Välj skal: `sh`, `bash` eller ange ett anpassat diagnoskommando.
  4. Sessionen startar i sshs3:s vanliga terminal och kan delas upp i Konsole-stilade split-paneler (<kbd>Ctrl+Shift+D</kbd> / <kbd>Ctrl+Shift+E</kbd>).
- **Begränsningar**:
  > [!WARNING]
  > **Distroless & Scratch Containrar**: Minimala containeravbildningar (som `scratch`, distroless eller strippade Go-binärer) som saknar ett POSIX-skal (`/bin/sh` eller `/bin/bash`) kan inte starta en interaktiv terminal. För dessa rekommenderas ephemeral debugging (se nedan).

---

### 2.2 Strömmande Containerloggar (Live Log Viewer)
- **Syfte**: Följa loggutdata (stdout/stderr) i realtid med sökning och filtrering.
- **Hur den används**:
  - Klicka på **View Logs** på valfri container.
  - **Follow**: Strömmar nya loggrader direkt när de skrivs.
  - **Tail Lines**: Välj hur många rader historik som ska hämtas initialt (`50`, `100`, `500` eller `1000`).
  - **Timestamps**: Slå på eller av ISO 8601-tidsstämplar på varje loggrad.
  - **Container Switcher**: För poddar med flera containrar (t.ex. sidovagnar som Envoy/Istio) byter du container direkt i rullgardinsmenyn.
  - **Previous Container Logs (`previous: true`)**:
    Bocka för *"Previous container instance"* för att läsa loggarna från den containerinstans som nyss kraschade vid `CrashLoopBackOff` eller `OOMKilled`.
- **Begränsningar**: Logghistoriken begränsas av klustrets konfigurerade loggrotationspolicy på noderna.

---

### 2.3 Container-filhanterare (`K8sPodStorageProvider`)
- **Syfte**: Bläddra i, ladda upp, ladda ner och redigera filer inuti containrar via tvåpanels-filhanteraren.
- **Hur den används**:
  - Öppna containern i vänster eller höger panel i filhanteraren.
  - Kopiera filer direkt mellan containern och din lokala dator, en SFTP-server eller en S3-bucket via dra-och-släpp.
  - Dubbelklicka på text- eller konfigurationsfiler för att öppna och redigera dem i den inbyggda texteditorn; tryck <kbd>Ctrl+S</kbd> för att spara direkt in i containern.
- **Hur det fungerar under huven**:
  - Inga agenter installeras i containern. Filoperationer strömmas via Kubernetes `exec`-protokoll (`cat`, `dd`, `stat`, `rm`, `mv`, `chmod`).
- **Begränsningar**:
  - Kräver standard POSIX-verktyg i containern (`cat`, `stat`, `chmod`).
  - Filer som skrivs till icke-beständiga volymer (utanför Persistent Volume Claims) försvinner om podden startar om.

---

### 2.4 Kubernetes Port Forwarding
- **Syfte**: Vidarebefordra portar från interna poddar eller klustertjänster (ClusterIP) till din lokala dator.
- **Hur den används**:
  1. Högerklicka på en Pod eller Service och välj **Port Forward**.
  2. Ange fjärrport och önskad lokal port (t.ex. `8080` → `8080`).
  3. Klicka **Start Forwarding**.
  4. Statusindikatorn visar överförda bytes och ger en direktlänk för att öppna tjänsten i din webbläsare (`http://localhost:8080`).
- **Begränsningar**: Vid nätverksavbrott mot API-servern bryts port forwarding-anslutningen och måste återupptas.

---

### 2.5 OpenShift-stöd
- **`oc login` Integration**:
  Klicka på **OpenShift Login** och klistra in inloggningskommandot från OpenShift Web Console:
  ```bash
  oc login --token=sha256~... --server=https://api.mycluster.openshift.com:6443
  ```
  sshs3 parsar token och API-URL och uppdaterar automatiskt din lokala `~/.kube/config`.
- **Projekt & SCC**: Behandlas med full paritet mot standard Kubernetes-namnrymder.
