# S3 & Cloud Storage (Complete Reference)

**sshs3** provides built-in support for object storage based on the AWS SDK v3, letting you manage cloud storage and buckets right alongside your servers and clusters.

![S3 profile form](/img/docs/s3-profile-form.png)

---

## 1. Supported Cloud Providers & S3-Compatible Services

sshs3 supports every provider that implements the S3 API:
- **Amazon Web Services (AWS S3)**: All global regions.
- **Cloudflare R2**: Zero data egress cost.
- **MinIO**: Self-hosted and on-premises clusters.
- **Wasabi Hot Cloud Storage**: High-performance cloud archiving.
- **Backblaze B2**: S3-compatible endpoints.
- **DigitalOcean Spaces & Ceph**: Private cloud solutions.

---

## 2. Authentication Modes & AWS SSO

When you create an S3 profile in the Connection Manager, sshs3 supports three authentication modes:

### A. Static IAM Keys (Access Key & Secret Key)
- Standard authentication with **Access Key ID** and **Secret Access Key**.
- The keys are encrypted in the operating system's secure keyring (Keychain / Secret Service / DPAPI).
- Support for an optional **Session Token** when using temporary STS credentials.

### B. AWS SSO / IAM Identity Center (Enterprise Login)
For companies that manage AWS through SSO and organizations:
1. Configure the **SSO Start URL** (for example `https://my-org.awsapps.com/start`) and the **SSO Region**.
2. Click **Login with AWS SSO**.
3. sshs3 starts the OIDC device flow and opens your default web browser with an 8-character verification code.
4. After approval in the browser, sshs3 fetches temporary STS credentials and shows a role picker where you choose the AWS account and IAM role.
5. Tokens are renewed automatically in the background.

### C. Custom Endpoints & Path-Style Addressing
For MinIO, R2, Wasabi or local Ceph storage:
- Enter your **Endpoint URL** (for example `https://s3.wasabisys.com` or `http://localhost:9000`).
- **Path-Style Addressing**:
  > [!IMPORTANT]
  > For MinIO and private servers, **Path-Style Addressing is mandatory**. It forces requests in the `endpoint/bucket/object` format instead of virtual hosting (`bucket.endpoint/object`), which prevents DNS errors with private IP addresses.

---

## 3. Advanced Object Operations & File Sharing

### 3.1 Presigned URLs
- **Purpose**: Share a private file from a closed S3 bucket with a customer or colleague without making the whole bucket public.
- **How it is used**:
  1. Right-click any file in the S3 pane and select **Generate Presigned URL**.
  2. Choose the validity period (15 minutes, 1 hour, 12 hours, 1 day or 7 days, which is the maximum).
  3. Click **Copy Link**. The link can now be pasted into a browser or sent in a chat. The recipient can download the file directly from AWS with the same level of security.

### 3.2 Object Versioning (S3 Versioning)
In buckets where versioning is enabled:
- Right-click an object and select **Version History**.
- Shows all previous versions of the file, their unique Version IDs, size and modification date.
- Restore an earlier version of a file if it has been overwritten by mistake.

### 3.3 Multipart Uploads
- Files larger than 5 MB are automatically split into smaller parts that are uploaded in parallel through the AWS SDK v3.
- Gives maximum transfer speed and lets interrupted uploads resume automatically after network disruptions.
- Transfer files directly between an S3 bucket and an SFTP server in a single operation without saving the file locally on your hard drive.
