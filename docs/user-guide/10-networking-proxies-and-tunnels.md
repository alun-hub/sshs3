# Nätverk, Proxys & SSH-Tunnlar (Komplett Nätverksguide)

**sshs3** tillhandahåller professionella nätverksverktyg för att navigera genom komplexa företagsnätverk, DMZ-zoner, bastioner och isolerade privata subnät.

---

## 1. ProxyJump (Bastion- & Jumphost-Kedjor)

När du ansluter till interna servrar i ett privat nätverk (som saknar publika IP-adresser) ansluter du via en mellanliggande bastion (hoppvärd):

```
┌─────────────────┐       ┌───────────────────────┐       ┌────────────────────────┐
│ Din Arbetsplats │ ────► │ Bastion (jumpbox.corp)│ ────► │ Intern Server (web-01) │
└─────────────────┘       └───────────────────────┘       └────────────────────────┘
         └────────────────── E2E Krypterad SSH Tunnel ───────────────────┘
```

### Konfiguration i Profilen:
- **Profilval (`proxyJumpProfileId`)**: Välj en befintlig sparad SSH-profil från rullgardinsmenyn som hoppvärd. sshs3 återanvänder automatiskt hoppvärdens nycklar, lösenord och portar.
- **Manuell hoppsträng (`proxyJump`)**: Ange en anpassad ProxyJump-sträng (t.ex. `jumpuser@bastion.example.com:22`).
- **Flerstegshopp (Multi-Hop)**: Separera flera hoppvärdar med kommatecken (`bastion1.corp.com,bastion2.dmz.internal`).
- **Säkerhet**: Trafiken är end-to-end-krypterad mellan din dator och slutmålet. Administratören på bastionen kan inte avlyssna eller dekryptera sessionen.

---

## 2. Fristående Bakgrundstunnlar (SSH Tunnels Panel)

I traditionella SSH-klienter avslutas portvidarebefordran i samma sekund som du stänger terminalfönstret. I sshs3 är **SSH Tunnels en fristående bakgrundstjänst** med en helt egen livscykel:

![Fristående SSH Tunnlar](/img/ssh-tunnels.png)

> [!IMPORTANT]
> **Oberoende Livscykel**: En tunnel som startats från SSH Tunnels-panelen fortsätter att köra i bakgrunden även om du stänger alla öppna terminalflikar eller arbetar i filhanteraren.

### 2.1 Stödda Tunnellägen

#### A. Local Port Forwarding (`-L`)
- **Syfte**: Gör en fjärrtjänst (t.ex. en intern PostgreSQL-databas eller ett internt webbgränssnitt) tillgänglig på en lokal port på din egen dator.
- **Exempel**:
  - `Local Port`: `5432`
  - `Remote Host`: `postgres.internal.corp`
  - `Remote Port`: `5432`
- **Resultat**: Du kan ansluta ditt lokala databasverktyg (DBeaver, psql) direkt till `localhost:5432`.

#### B. Remote Port Forwarding (`-R`)
- **Syfte**: Exponerar en lokal webbserver eller tjänst som körs på din dator för det fjärranslutna nätverket.
- **Exempel**: Exponera din lokala utvecklingsserver på `localhost:3000` som port `8080` på fjärrservern så att kollegor kan testa ditt API.

#### C. Dynamic Port Forwarding (SOCKS5 Proxy `-D`)
- **Syfte**: Startar en lokal SOCKS5-proxy på din maskin (t.ex. `127.0.0.1:1080`).
- **Hur det används**: Konfigurera din webbläsare (Firefox, Chrome) eller verktyg (`curl --socks5 127.0.0.1:1080`) att skicka trafik genom tunneln. All webbtrafik routas då krypterat genom SSH-servern och ut på dess lokala nätverk.

### 2.2 Spara & Hantera Tunnlar
- Klicka på knappen **SSH Tunnels** i toppraden för att öppna tunnelpanelen.
- Skapa och namnge återanvändbara tunnelkonfigurationer (t.ex. *"Prod DB Tunnel"*).
- Starta och stoppa med ett klick. Statusindikatorn visar realtidstrafik och aktiv process.

---

## 3. X11 & Grafisk Vidarebefordran (GUI Forwarding)

Kör grafiska Linux-program (som `virt-manager`, `xclock`, `gvim`, eller proprietära diagnosverktyg) på fjärrservern och visa fönstren sömlöst på ditt skrivbord:

- **Linux**: Använder din lokala `$DISPLAY` (fungerar i både X11 och via XWayland).
- **Windows**: Den officiella installationsfilen (`sshs3-Setup-*.exe`) **inkluderar den beprövade VcXsrv X-servern**. sshs3 startar och konfigurerar display-routingen automatiskt när du ansluter till en profil med X11 aktiverat.
