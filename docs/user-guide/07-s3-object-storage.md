# S3 & Molnlagring (Komplett Referenshandbok)

**sshs3** tillhandahåller inbyggt stöd för objektlagring baserat på AWS SDK v3, vilket gör att du kan hantera molnlagring och bucketar direkt vid sidan av dina servrar och kluster.

![S3 Profilformulär](/img/docs/s3-profile-form.png)

---

## 1. Stödda Molnleverantörer & S3-Kompatibla Tjänster

sshs3 stöder alla leverantörer som implementerar S3-API:et:
- **Amazon Web Services (AWS S3)**: Alla globala regioner.
- **Cloudflare R2**: Noll kostnad för data egress.
- **MinIO**: Självhostade och on-premise kluster.
- **Wasabi Hot Cloud Storage**: Högpresterande molnarkivering.
- **Backblaze B2**: S3-kompatibla endpoints.
- **DigitalOcean Spaces & Ceph**: Privata molnlösningar.

---

## 2. Autentiseringslägen & AWS SSO

När du skapar en S3-profil i Connection Managern stöder sshs3 tre autentiseringslägen:

### A. Statiska IAM-Nycklar (Access Key & Secret Key)
- Standardautentisering med **Access Key ID** och **Secret Access Key**.
- Nycklarna krypteras i operativsystemets säkra nyckelring (Keychain / Secret Service / DPAPI).
- Stöd för valfri **Session Token** vid användning av temporära STS-credentials.

### B. AWS SSO / IAM Identity Center (Företagsinloggning)
För företag som hanterar AWS via SSO och organisationer:
1. Konfigurera **SSO Start URL** (t.ex. `https://my-org.awsapps.com/start`) och **SSO Region**.
2. Klicka på **Login with AWS SSO**.
3. sshs3 initierar OIDC-enhetsflödet och öppnar din standardwebbläsare med en 8-teckens verifieringskod.
4. Efter godkännande i webbläsaren hämtar sshs3 temporära STS-uppgifter och visar en rollväljare där du väljer AWS-konto och IAM-roll.
5. Tokens förnyas automatiskt i bakgrunden.

### C. Anpassade Endpoints & Path-Style Addressing
För MinIO, R2, Wasabi eller lokal Ceph-lagring:
- Ange din **Endpoint URL** (t.ex. `https://s3.wasabisys.com` eller `http://localhost:9000`).
- **Path-Style Addressing**:
  > [!IMPORTANT]
  > För MinIO och privata servrar är **Path-Style Addressing obligatoriskt**. Det tvingar anrop i formatet `endpoint/bucket/object` istället för virtuell hosting (`bucket.endpoint/object`), vilket förhindrar DNS-fel vid privata IP-adresser.

---

## 3. Avancerade Objektoperationer & Fildelning

### 3.1 Förhandssignerade Länkar (Presigned URLs)
- **Syfte**: Dela en privat fil från en sluten S3-bucket med en kund eller kollega utan att göra hela bucketen offentlig.
- **Hur det används**:
  1. Högerklicka på valfri fil i S3-panelen och välj **Generate Presigned URL**.
  2. Välj giltighetstid (15 minuter, 1 timme, 12 timmar, 1 dag eller 7 dagar, som är maxgränsen).
  3. Klicka **Copy Link**. Länken kan nu klistras in i en webbläsare eller skickas via chatt. Mottagaren kan ladda ner filen direkt från AWS med samma säkerhet.

### 3.2 Objektversionering (S3 Versioning)
I buckets där versionshantering är aktiverad:
- Högerklicka på ett objekt och välj **Version History**.
- Visar alla tidigare versioner av filen, deras unika Version IDs, storlek och ändringsdatum.
- Återställ en tidigare version av en fil om den oavsiktligt har skrivits över.

### 3.3 Flerdelad Uppladdning (Multipart Uploads)
- Filer större än 5 MB delas automatiskt upp i mindre delar som laddas upp parallellt via AWS SDK v3.
- Ger maximal överföringshastighet och gör att avbrutna uppladdningar kan återupptas automatiskt vid nätverksstörningar.
- Överför filer direkt mellan en S3-bucket och en SFTP-server i en enda operation utan att spara filen lokalt på din hårddisk.
