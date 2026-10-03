# Connection Manager & Profiles (Komplett Referenshandbok)

Connection Managern är centralnavet i **sshs3** för att skapa, redigera, gruppera och säkra alla dina anslutningsmål: SSH-servrar, lokala terminaler, Kubernetes-kluster och S3-kompatibel molnlagring.

---

## 1. Översikt över Profiltyper

sshs3 stöder fyra grundläggande profiltyper:

1. **SSH-profiler**: Anslutningar via systemets egna OpenSSH-binär (`node-pty`) till Linux-, UNIX-, BSD- och Windows-värdar med stöd för SFTP och bakgrundstunnlar.
2. **Lokala skalprofiler**: Kör terminaler direkt på din lokala dator (`$SHELL` på Linux/macOS; PowerShell, `pwsh`, CMD eller WSL på Windows) med automatiskt integrerad `SSH_AUTH_SOCK`.
3. **Kubernetes-profiler**: Direkt koppling mot kontexter, namnrymder, poddar och containrar i `~/.kube/config` eller via OpenShift `oc login`.
4. **S3-lagringsprofiler**: Moln- och objektlagring mot AWS S3, Cloudflare R2, MinIO, Wasabi och Backblaze B2.

---

## 2. SSH-profilformuläret: Komplett Fältreferens

När du klickar på **New Profile** (eller redigerar en befintlig SSH-profil) visas profilformuläret:

![SSH Profilformulär](/img/docs/profile-new-ssh.png)

### 2.1 Grundläggande Egenskaper (General)

| Fältnamn | Standardvärde | Syfte & Beskrivning | Begränsningar & Kantfall |
| :--- | :--- | :--- | :--- |
| **Profile Name** | `e.g. Production Server` | Ett läsbart visningsnamn för profilen som visas i anslutningslistan, flikar och delade paneler. | Får inte vara tomt. Specialtecken tillåts, men korta och tydliga namn rekommenderas för att inte klippa fliktitlar. |
| **Group / Folder** | *Tomt* (Valfritt) | Grupperar profiler i trädstrukturen i Connection Managern (t.ex. `Production`, `Staging`, `Kunder/Kund-A`). | Undermappar kan skapas med snedstreck (`/`). Om fältet lämnas tomt placeras profilen på rotnivån. |
| **Hostname / IP** | *Obligatoriskt* | Fjärrvärdens FQDN (t.ex. `web01.corp.internal`) eller IPv4/IPv6-adress. | Måste kunna slås upp via DNS eller vara nåbar via IP. Vid ProxyJump är detta värdnamnet som bastionen når. |
| **Port** | `22` | TCP-porten för SSH-demonen på målvärden. | Heltal mellan 1 och 65535. Standard är alltid 22. |
| **Username** | *Obligatoriskt* | Användarnamnet för inloggningen på fjärrvärden (t.ex. `ubuntu`, `root`, `deploy`). | Följer standard POSIX-regler för användarnamn. |
| **Initial SFTP Path** | *Tomt* (Valfritt) | Standardkatalog som filhanteraren automatiskt öppnar vid SFTP-anslutning (t.ex. `/var/www` eller `/home/user`). | Om sökvägen inte existerar på fjärrservern faller filhanteraren automatiskt tillbaka till användarens hemkatalog. |

---

### 2.2 Autentiseringsmetoder (`authType`)

sshs3 stöder fem separata autentiseringsmetoder i rullgardinsmenyn **Authentication**:

#### A. Password (Lösenord)
- **Syfte**: Standardautentisering med lösenord. Krävs även av SFTP om inte nyckelbaserad inloggning används.
- **Hur den används**: Ange lösenordet i inmatningsfältet. Lösenordet krypteras i OS Keychain (Linux Secret Service / Windows DPAPI / macOS Keychain).
- **Begränsningar**: Om lösenordsfältet lämnas tomt kommer du att uppmanas att ange lösenordet interaktivt i terminalen vid anslutning. Interaktiv lösenordsinloggning stöds inte av den bakgrundsbaserade prestandabalken (Performance Bar) på Windows.

#### B. SSH Key (Privat Nyckelfil)
![SSH Key Autentisering](/img/docs/profile-auth-privatekey.png)
- **Syfte**: Asymmetrisk nyckelautentisering med privat nyckel sparad på disk.
- **Hur den används**: Klicka på **Browse…** för att välja din privata nyckelfil (t.ex. `~/.ssh/id_ed25519` eller `~/.ssh/id_rsa`). Om nyckeln är krypterad med en lösenfras kan denna anges i fältet **Passphrase**.
- **Begränsningar**: Filen måste vara läsbar av den lokala användaren. Lösenfrasen sparas krypterad i systemets nyckelring.

#### C. SSH Agent
- **Syfte**: Återanvänder nycklar som redan är upplåsta i din lokala `ssh-agent` eller Windows OpenSSH Authentication Agent.
- **Hur den används**: Välj "SSH Agent". Inga lösenord eller nyckelsökvägar behöver anges i profilen.
- **Begränsningar**: Kräver att en agent körs i operativsystemet och att nyckeln redan har lagts till (`ssh-add`). Om agenten inte har nyckeln laddad nekas inloggningen.

#### D. Smartcard (PKCS#11)
![Smartcard PKCS#11 Autentisering](/img/docs/profile-auth-smartcard.png)
- **Syfte**: Hårdvaruautentisering med smartcard eller YubiKey PIV via ett PKCS#11-kryptografiskt bibliotek.
- **Hur den används**: sshs3 söker automatiskt igenom kända bibliotekssökvägar och visar snabbknappar:
  - **p11-kit** (`p11-kit-proxy.so`): Standardval på Linux; proxar alla registrerade tokens i systemet.
  - **YubiKey (`libykcs11`)**: Direktbibliotek för YubiKey PIV (`libykcs11.so` / `libykcs11.dll`).
  - **OpenSC (`opensc-pkcs11.so` / `opensc-pkcs11.dll`)**: Generell öppen drivrutin för de flesta smartcards.
  - **Net iD**: Stöd för företags- och myndighetskort.
- **Begränsningar**: Biblioteksfilen måste finnas installerad lokalt på datorn. PIN-kod cachas enligt den valda policyn (Per-Session, Global eller Never) och skrivs aldrig till disk.

#### E. FIDO2 / Security Key (Hårdvarunyckel)
![FIDO2 Hårdvarunyckel](/img/docs/profile-auth-fido2.png)
- **Syfte**: Maskinvaru-autentisering med FIDO2/WebAuthn-nycklar (t.ex. YubiKey 5-serien).
- **Hur den används**:
  - **Discoverable / Resident Credentials**: Läs in inbyggda resident-nycklar direkt från ansluten säkerhetsnyckel med knappen **Scan Security Key**.
  - **Key File**: Välj en genererad `id_ed25519_sk`- eller `id_ecdsa_sk`-fil på disken.
  - **Inbyggd Nyckelgenerator**: Klicka på **Generate FIDO2 Key** för att skapa en ny FIDO2-nyckel direkt i appen med val för typ (`ed25519-sk` vs `ecdsa-sk`), resident credential (`-O resident`) och användarverifiering (`-O verify-required`).
- **Begränsningar**: Fjärrserverns OpenSSH-demon måste vara minst version 8.2 för att stödja FIDO2-kryptografiska algoritmer. Vid inloggning krävs fysisk beröring av nyckeln när **Touch-Presence Banner** visas.

---

### 2.3 Access Check & Nyckelinstallation (`ssh-copy-id` GUI)

Längst ner i profilformuläret finns sektionen **Access**:

![Access Check och Nyckelinstallation](/img/docs/profile-install-key-modal.png)

- **Test Connection / Access Check Timeline**:
  En 5-stegs visuell tidslinje som testar hela anslutningskedjan:
  1. `Reach Host`: TCP-uppkoppling till IP/port (inkl. via ProxyJump).
  2. `Host Key`: Verifierar att serverns värdnyckel stämmer med `known_hosts`.
  3. `Allowed Methods`: Frågar sshd tyst vilka inloggningsmetoder som tillåts (lösenord, publickey, etc.) utan att kräva PIN eller beröring.
  4. `Key Installed`: Undersöker om den valda publika nyckeln finns i `~/.ssh/authorized_keys`.
  5. `Login Works`: Testar faktisk inloggning.
- **Install Key…**:
  Installerar en eller flera valda publika nycklar direkt i serverns `~/.ssh/authorized_keys` i en enda session. Sätter automatiskt `0700` på `~/.ssh` och `0600` på `authorized_keys`.
- **Copy Command**:
  Genererar ett läsbart skalskript med ett klick för servrar som inte kan nås direkt från din arbetsstation.

---

### 2.4 Avancerade SSH-alternativ (Advanced SSH Options)

Genom att expandera sektionen **Advanced SSH Options** får du tillgång till finkorniga nätverks- och protokollparametrar:

![Avancerade SSH-alternativ](/img/docs/profile-advanced-options.png)

| Fält / Alternativ | Standard | Syfte & Beskrivning | Begränsningar |
| :--- | :--- | :--- | :--- |
| **Agent Forwarding (`-A`)** | Av | Vidarebefordrar din lokala SSH-agent till fjärrvärden så att du kan hoppa vidare till andra servrar utan att kopiera privata nycklar. | **Säkerhetsvarning**: Aktivera endast på servrar du litar på. En administratör på fjärrvärden kan temporärt komma åt din lokala agent via den exponerade socketslingan. |
| **X11 Forwarding (`-Y`)** | Av | Vidarebefordrar X11-fönster från grafiska Linux-program till din lokala skärm. | På Windows startar appen automatiskt den medföljande VcXsrv-servern. På Linux krävs en lokal `$DISPLAY` (X11 eller XWayland). |
| **Custom X11 Display** | *Tomt* (Auto) | Manuell skärmidentifierare (t.ex. `127.0.0.1:0.0` på Windows eller `:0` på Linux). | Överskrider automatisk detektering. |
| **Compression (`-C`)** | Av | Aktiverar gzip-komprimering av SSH-trafik. | Förbättrar prestanda över långsamma mobiluppkopplingar, men kan öka CPU-belastningen på snabba gigabit-nätverk. |
| **ServerAliveInterval** | `0` (Av) | Skickar periodiska keepalive-paket till servern (i sekunder) för att förhindra att brandväggar och NAT stänger inaktiva anslutningar. | Värde i sekunder (t.ex. `30` eller `60`). 0 stänger av funktionen. |
| **Custom Ciphers** | *System default* | Begränsar tillåtna krypteringsalgoritmer (t.ex. `chacha20-poly1305@openssh.com,aes256-gcm@openssh.com`). | Algoritmerna måste stödjas av både klientens och serverns OpenSSH-binärer. |
| **KEX Algorithms** | *System default* | Begränsar godkända nyckelutbytesalgoritmer (t.ex. `curve25519-sha256,diffie-hellman-group16-sha512`). | Används vid hårda säkerhetskrav eller vid anslutning till äldre hårdvara. |
| **MAC Algorithms** | *System default* | Begränsar Message Authentication Codes (t.ex. `hmac-sha2-512-etm@openssh.com`). | Endast relevant för icke-AEAD ciphers. |
| **Custom SSH Arguments** | *Tomt* | Fria `-o Option=Value`-parametrar som skickas rakt in i `ssh`-kommandot. | Felaktiga flaggor kan göra att OpenSSH vägrar starta. |
| **Auto Reconnect** | Av | Återansluter automatiskt vid oväntade nätverksavbrott. | Har inställningar för max återförsök (standard: 3) och fördröjning i millisekunder. |
| **Dotfiles Pool Sync** | *Av* | Kopplar profilen till en dotfile-pool för automatisk miljöinläsning vid start. | Kräver att Dotfiles Pool är aktiverad i appens inställningar. |

---

## 3. S3-profilformuläret: Komplett Fältreferens

Klicka på fliken **S3 Object Storage** och därefter **New Profile** för att konfigurera en objektlagringsprofil:

![S3 Profilformulär](/img/docs/s3-profile-form.png)

| Fältnamn | Standardvärde | Syfte & Beskrivning | Begränsningar |
| :--- | :--- | :--- | :--- |
| **Profile Name** | `e.g. Backup Bucket` | Visningsnamn i trädlistan och filhanteraren. | Får inte vara tomt. |
| **Group / Folder** | *Tomt* (Valfritt) | Undermapp för att strukturera molnkonton och miljöer. | Valfritt. |
| **Region** | `us-east-1` | AWS- eller molnregion (t.ex. `eu-north-1`, `auto` för Cloudflare R2, eller `us-east-1` för MinIO). | Måste matcha bucketens faktiska region. |
| **Endpoint URL** | *Tomt* (AWS) | Anpassad S3-endpoint för MinIO, R2, Wasabi eller lokal Ceph-kluster (t.ex. `https://s3.wasabisys.com` eller `http://localhost:9000`). | Lämnas tomt om du använder officiella Amazon Web Services (AWS). |
| **Initial Path** | *Tomt* (`/`) | Öppnar automatiskt en specifik bucket eller virtuell mapp (t.ex. `my-bucket/logs/`). | Måste vara en giltig sökväg. |
| **Access Key ID** | *Obligatoriskt vid statisk auth* | Statisk åtkomstnyckel för S3 IAM-användaren. | Sparas krypterat i OS Keychain. |
| **Secret Access Key** | *Obligatoriskt vid statisk auth* | Hemlig åtkomstnyckel för S3 IAM-användaren. | Sparas krypterat i OS Keychain. |
| **Session Token** | *Tomt* (Valfritt) | Temporär säkerhetstoken (STS) vid temporära credentials. | Upphör att gälla när STS-sessionen löper ut. |
| **Path-style addressing** | På | Tvingar anrop i formatet `endpoint/bucket/key` istället för virtuell hosting `bucket.endpoint/key`. | **Kritiskt för MinIO**, Ceph och lokala Docker-containrar där DNS-subdomäner inte pekar mot rätt IP. |
| **Use SSL/TLS** | På | Krypterar all S3-datatrafik med HTTPS. | Kan stängas av för lokal utveckling mot `http://localhost:9000`. |
| **Allow self-signed certs** | Av | Tillåter självsignerade TLS-certifikat på privata MinIO-servrar. | Ska endast användas i interna labbmiljöer. |
| **Server-Side Encryption** | `None` | Kryptering vid lagring på servern: `None`, `SSE-S3 (AES256)` eller `SSE-KMS`. | Vid SSE-KMS krävs att rätt KMS Key ID är konfigurerat på servern. |
| **Outgoing Proxy** | Av | Slussar all S3 API-trafik via en HTTP- eller SOCKS5-proxy. | Stöder användarnamn och lösenord för proxyn. |
