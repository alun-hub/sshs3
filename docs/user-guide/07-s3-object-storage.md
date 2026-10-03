# S3 & Cloud Object Storage

sshs3 provides native object storage capabilities built directly on the AWS SDK v3, allowing you to manage cloud storage alongside your servers and clusters.

---

## Supported Providers & Endpoints

sshs3 supports any storage service implementing the standard S3 API:
- **Amazon S3** (All standard AWS regions)
- **Cloudflare R2**
- **MinIO** (Self-hosted & on-premise clusters)
- **Wasabi Hot Cloud Storage**
- **Backblaze B2** (S3-compatible endpoint)
- **DigitalOcean Spaces**
- **Ceph / NetApp StorageGRID**

---

## Authentication Modes

When setting up an S3 Profile in the Connection Manager:

### 1. Static Access Keys
- **Access Key ID** & **Secret Access Key**
- Stored safely in your operating system's native keychain.

### 2. AWS SSO & IAM Identity Center
For enterprise environments using AWS Organizations and Single Sign-On:
- Configure your **SSO Start URL** (e.g. `https://my-company.awsapps.com/start`) and **SSO Region**.
- Click **Login with AWS SSO**.
- sshs3 automatically initiates the device authorization flow, opens your system browser, and prompts you to verify the authorization code.
- Once approved, sshs3 securely retrieves ephemeral STS credentials and presents a role-picker modal to select your target AWS Account and IAM Role.
- Tokens are automatically refreshed in the background.

### 3. Custom S3 Endpoints
For MinIO, R2, Wasabi, or local development:
- Check **Use Custom Endpoint**.
- Enter URL (e.g. `https://s3.wasabisys.com` or `http://localhost:9000`).
- Toggle **Path-style addressing** (recommended for MinIO and legacy setups where buckets are passed as paths rather than subdomains).

---

## Bucket & Object Management

- **Bucket Hierarchy**: Browse buckets in the Connection Manager or open them inside either pane of the File Manager.
- **Multipart Upload Engine**: Files exceeding 5 MB are automatically chunked and transferred using S3 Multipart Uploads, ensuring optimal transfer speeds and resumability.
- **Object Metadata & Storage Classes**: Inspect and set S3 object metadata, HTTP headers (`Content-Type`, `Cache-Control`), and storage tiers (`STANDARD`, `INTELLIGENT_TIERING`, `GLACIER`, etc.).
- **Bucket Creation & Deletion**: Create new buckets with region selection, or empty and remove existing buckets.
- **S3-to-Server Transfers**: Transfer files directly between an S3 bucket and an SSH/SFTP server in a single operation without first downloading them to your local computer.
