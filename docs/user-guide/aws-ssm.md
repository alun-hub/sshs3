## SSH over AWS Systems Manager (Experimental)

Connect to EC2 instances (or hybrid nodes) that have no public SSH port through AWS Systems Manager Session Manager. There are two connection types:

| Connection type | What you get | What it needs |
|-----------------|--------------|---------------|
| **SSH over SSM** | A normal SSH profile: terminal, file manager, editor, search, directory sync, tunnels and key install. sshs3 hands OpenSSH the AWS-documented `ProxyCommand`. | sshd on the instance and SSH authentication (agent or key). |
| **Session Manager shell** | A terminal like **Connect → Session Manager** in the EC2 console. IAM decides who may connect; you log in as `ssm-user`. | Only the SSM Agent and IAM permissions: no sshd, no key. Terminal only; files, tunnels and key install need SSH. |

You can type an instance ID, or sign in once and let sshs3 list what you have across accounts and regions.

> [!IMPORTANT]
> This feature is **Experimental**. It has been tested end to end on Linux (Fedora) against a live AWS account with Amazon Linux 2023: an AWS CLI profile (`aws login`), the default credential chain and IAM Identity Center sign-in. Windows is verified for the `ProxyCommand` hand-off only, and Debian/Ubuntu, very large organizations, SCP region restrictions and corporate proxies are covered by automated tests but not yet tried against real environments.

## 1. Requirements

| Requirement | Detail |
|-------------|--------|
| AWS CLI v2 | Install it yourself; sshs3 finds it on `PATH` and in the standard install folders. |
| Session Manager plugin | Version 1.1.23.0 or newer. sshs3 shows install steps and notices when it appears. |
| On the instance | SSM Agent 2.3.672.0 or newer, an instance profile that lets it register with SSM, **and a running SSH daemon**. |
| IAM permissions | `ssm:StartSession` on the instance and on the document `AWS-StartSSHSession` (SSH over SSM) or `SSM-SessionManagerRunShell` (Session Manager shell), plus `ssmmessages:OpenDataChannel`. Listing also needs `ssm:DescribeInstanceInformation`; names from the EC2 `Name` tag need `ec2:DescribeInstances` (optional). |

> [!NOTE]
> With **SSH over SSM**, SSM only carries the TCP connection: you still need SSH authentication (key, agent or password) as for any profile. A Permission denied (publickey…) error means the instance does not accept the key you offered; choose a key file that matches the instance's key pair, or use a Session Manager shell.

## 2. Turn on AWS features

AWS features are off until you switch them on, so they stay out of the way if you do not use AWS. Open **Settings → AWS** and enable **Enable AWS features**.

| Setting | What it does |
|---------|--------------|
| **AWS sign-ins** | Saved IAM Identity Center sign-ins (name, start URL, region) with their status and a **Sign in** button. Sign-ins from your organization's policy are shown locked. |
| **Regions to search** | Regions used by **Add from AWS**, comma separated. Empty means you choose each time. |
| **Network** | HTTPS proxy, custom CA certificate and TLS verification, used for sign-in, listing and searching, and passed to the `aws` CLI as `HTTPS_PROXY` and `AWS_CA_BUNDLE`. A proxy that needs a login is not supported for the CLI. |
| **Tools and AWS CLI profiles** | Whether the AWS CLI and the plugin are installed, and how many AWS CLI profiles sshs3 found. |

With AWS features on, an **AWS** button appears in the top bar next to the SSH CA button: green when you are signed in, amber when a sign-in used by your profiles has expired. Click it to sign in, to add instances or to open **Settings → AWS**.

## 3. Add instances from AWS

Press **Add from AWS…** in the SSH tab of the connection manager (or in the AWS button's menu). The dialog walks through four things.

| Step | Details |
|------|---------|
| **Credentials** | **AWS sign-in (SSO)** uses a saved sign-in or a start URL you type (the access portal URL `https://d-….awsapps.com/start`, or for newer instances `https://identitycenter.amazonaws.com/ssoins-…`). **AWS CLI profiles** lists the profiles in `~/.aws/config` and `~/.aws/credentials` (SSO, assume-role, access keys, `aws login`, credential process); **Check** shows whether one can produce credentials and **Sign in** runs `aws sso login --profile` for an SSO profile. **Default credentials** uses environment variables, your default profile or an instance role. |
| **Accounts and role** | For SSO: tick the accounts. Each ticked account shows a drop-down with its own roles (loaded when you tick it; a single role is preselected, otherwise your last used one), and **Same role everywhere** applies one role to all ticked accounts that have it. Search starts once every ticked account has a role. If the portal cannot list accounts or roles, type the account IDs and role names instead. |
| **Regions** | Tick the regions to search. The list from **Settings → AWS** (or policy) is preselected. |
| **Connect with** | Appears once instances are found: **SSH over SSM** (with **SSH agent** or a **Private key file**) or **Session Manager shell (no SSH)**. It applies to all instances you import in this run. |
| **Instances** | **Find instances** searches every account and region at once, shows progress and can be cancelled. Results are grouped by account and region; nodes that already have a profile are marked **Already added**. Set the SSH login per instance (suggested from the platform) and press **Import selected**. |

Imported profiles go into the folder `AWS/<account>/<region>` and carry the credentials they were found with. Shell profiles show **SSM shell** in the list and have no SSH user. If two nodes in a folder share a name, the instance ID is appended so they do not become one "system" with **Connect all**.

> [!NOTE]
> Only nodes that are online in Systems Manager are listed (EC2 instances and hybrid `mi-…` nodes), so an instance without the SSM Agent or an instance profile will not appear, and the list cannot tell whether an SSH daemon is running. Windows nodes are hidden. Names come from the EC2 `Name` tag when the role may read it, otherwise from the host name. A search is cut at 500 instances; searches denied by the organization (for example a region blocked by policy) are skipped and summarized.

## 4. A single profile

1. Open the SSH profile form and enable **Connect via AWS Systems Manager (SSM)**.
2. Choose the **Connection type**: **SSH over SSM** or **Session Manager shell (no SSH, no keys)**.
3. Press **Pick from AWS…** to choose the instance from a list, or enter the instance ID (`i-0123456789abcdef0`) as **Hostname** and the SSH user (for example `ec2-user` on Amazon Linux, `ubuntu` on Ubuntu).
4. Choose **AWS credentials**:

| Source | Use when |
|--------|----------|
| AWS sign-in (SSO) | You use IAM Identity Center. Pick a saved sign-in; the account and role are filled in and can be changed under **Sign-in, account and role**. |
| AWS CLI profile | A named profile (any kind the AWS CLI supports); detected profiles are suggested. |
| Default credentials | You already use the AWS CLI with environment variables or a default profile. |

5. Set the **Region of the instance** (required with SSO sign-in, because the Identity Center home region is often a different one).

A jump host or outgoing proxy cannot be combined with SSM; enabling SSM clears them. An SSM profile also cannot be used as another profile's jump host. The sign-in used with SSO: the access portal needs permission sets enabled; an instance that uses *account access manager* without permission sets cannot be used for this sign-in, so use an AWS CLI profile instead.

### Technical Internals: ProxyCommand and credentials

sshs3 adds `-o ProxyCommand=…aws ssm start-session --target %h --document-name AWS-StartSSHSession --parameters portNumber=%p` to every `ssh` it starts for the profile. Region, profile and instance ID are validated before use. For an sshs3 sign-in, a small app-owned AWS config file (no secrets) points the CLI at the token sshs3 already caches; for a CLI profile, your own configuration is used. When you choose a credential source, ambient AWS key variables are cleared for that connection; with default credentials your environment is left alone. The token itself never leaves sshs3's main process: the dialog only receives status, expiry and the lists AWS returned.

## 5. For organizations

| Need | How |
|------|-----|
| Many accounts | Tick the accounts and pick a role per account (or one for all); sshs3 searches them in parallel with a small limit and skips what is denied. |
| Preconfigured sign-ins | Policy `awsManagedSignIns` adds locked sign-ins for everyone; policy `awsRegions` sets the regions; policy `enableAws` turns the features on or off; policy `awsSsm` blocks SSH over SSM entirely. See [Enterprise deployment](/docs/reference/enterprise-deployment/). |
| Corporate proxy or TLS inspection | **Settings → AWS → Network**. |
| Names that mean something | Tag instances with `Name` and allow `ec2:DescribeInstances`. |
| Audit | Session Manager activity is recorded in CloudTrail; AWS offers no session logging for SSH over SSM. |

## 6. Limits

- The AWS CLI itself caches short-lived role credentials in `~/.aws/cli/cache`; sshs3 does not write them.
- Account and role lists (here and in the S3 profile form) are fetched through the proxy and CA in **Settings → AWS → Network**, never through a setting sent from a profile form; if the list cannot be loaded, type the account ID and role name.
- A CLI profile that asks for an MFA code cannot be answered from the app; run `aws sts get-caller-identity --profile <name>` once in a terminal, then try again.
- sshs3's own sign-in has no refresh token: sign in again when the Identity Center session ends (the AWS button turns amber). CLI profiles with an `sso-session` refresh on their own.
- On Windows every connection opens its own SSM session (no connection sharing).
- SSM profiles are not exported to `~/.ssh/config`, and the performance bar does not show a TCP ping.
- A Session Manager shell is terminal only (no file manager, editor, tunnels or key install), has no automatic reconnect, and logs in as the account AWS gives its sessions (`ssm-user` unless configured otherwise in Session Manager preferences).
- Custom SSM documents and port forwarding through Session Manager are not available yet.

## 7. Troubleshooting & Diagnostics

| Symptom | Probable Root Cause | Corrective Action |
|---------|--------------------|-------------------|
| No AWS button, no **Add from AWS…** | AWS features are off | Enable them under **Settings → AWS** (or ask your administrator if the switch is locked). |
| Tool panel says **Missing** | AWS CLI or plugin not installed, or not in a standard folder | Install both; the panel updates on its own, or press **Check again**. |
| Panel says **Too old** | Session Manager plugin below 1.1.23.0 | Update the plugin. |
| `AccessDeniedException … ssm:StartSession on …document/SSM-SessionManagerRunShell` | The role may start SSH sessions but not shell sessions | Allow `ssm:StartSession` on the document `arn:aws:ssm:*:*:document/SSM-SessionManagerRunShell` too (or the document your Session Manager preferences use). |
| "Permission denied (publickey…)" | SSH over SSM reached the instance, but it does not accept the key | Pick a key file that matches the instance's key pair in the profile, load the key into your agent, or use a Session Manager shell. |
| Connection closes immediately | Wrong region, instance not SSM-managed, no IAM permission, or no SSH daemon | Check the **Region of the instance**, that the instance appears in Systems Manager Fleet Manager, the permissions above, and that `sshd` runs. |
| "Instance ID must look like i-…" | Hostname is a DNS name | Enter the instance ID, or disable SSM. |
| Sign-in expired | Identity Center session ended | Terminals sign in again automatically; otherwise use the AWS button or **Settings → AWS**, then reconnect. |
| Instance missing from the list | No SSM Agent, no instance profile, offline, Windows node, or another account or region | Check Fleet Manager in the AWS console, the accounts and regions you selected, and **Why were some skipped?**. |
| "Searched N, skipped M: access denied" | The role cannot call SSM in that account or region (often an organization policy) | Remove those regions, or ask for `ssm:DescribeInstanceInformation`. |
| A CLI profile says it needs an MFA code | The profile asks for input the app cannot give | Run `aws sts get-caller-identity --profile <name>` in a terminal once. |
| Sign-in or listing fails behind a proxy | AWS endpoints reachable only through the proxy | Set the proxy and CA under **Settings → AWS → Network**. |
