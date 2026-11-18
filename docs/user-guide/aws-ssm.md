## SSH over AWS Systems Manager (Experimental)

Connect to EC2 instances (or hybrid nodes) that have no public SSH port by tunnelling SSH through AWS Systems Manager Session Manager. sshs3 hands OpenSSH the AWS-documented `ProxyCommand`, so the terminal, file manager, editor, search, directory sync, tunnels and key install all work like on any other SSH profile.

> [!IMPORTANT]
> This feature is **Experimental**. It has been tested end to end on Linux (Fedora) against a live AWS account with Amazon Linux 2023 (AWS CLI profile, default credentials and IAM Identity Center sign-in). Windows is verified for the `ProxyCommand` hand-off only, and Debian/Ubuntu are not tested.

## 1. Requirements

| Requirement | Detail |
|-------------|--------|
| AWS CLI v2 | Install it yourself; sshs3 finds it on `PATH` and in the standard install folders. |
| Session Manager plugin | Version 1.1.23.0 or newer. sshs3 shows install steps and notices when it appears. |
| On the instance | SSM Agent 2.3.672.0 or newer, an instance profile that lets it register with SSM, **and a running SSH daemon**. |
| IAM permissions | `ssm:StartSession` on the instance and on the document `AWS-StartSSHSession`, plus `ssmmessages:OpenDataChannel`. |

> [!NOTE]
> SSM only carries the TCP connection. You still need SSH authentication (key, agent or password) as for any profile.

## 2. Creating a profile

1. Open the SSH profile form and enable **Connect via AWS Systems Manager (SSM)**.
2. Enter the instance ID (`i-0123456789abcdef0`) as **Hostname**, and the SSH user (for example `ec2-user` on Amazon Linux, `ubuntu` on Ubuntu).
3. Choose **AWS credentials**:

| Source | Use when |
|--------|----------|
| Default AWS CLI credentials | You already use the AWS CLI (environment variables, default profile). |
| AWS CLI profile | A named profile, for example after `aws sso login --profile prod`. |
| Signed in with sshs3 (SSO) | Enter start URL, SSO region, account ID and role name and press **Sign in**. The start URL is the access portal URL (`https://d-….awsapps.com/start`) or, for newer instances, the issuer URL (`https://identitycenter.amazonaws.com/ssoins-…`). The SSO region is where Identity Center lives; the instance region below can differ. The permission set needs the actions listed under IAM permissions. An instance that uses *account access manager* without permission sets cannot be used for this sign-in; use an AWS CLI profile instead. sshs3 uses the same IAM Identity Center sign-in as S3 profiles and writes only a small app-owned AWS config file. |

4. Set the **Region** of the instance (required with SSO sign-in, because the Identity Center home region is often a different one; optional otherwise). The tool panel shows whether the AWS CLI and plugin were found and switches to **Ready** by itself once you install them.

A jump host or outgoing proxy cannot be combined with SSM; enabling SSM clears them. An SSM profile also cannot be used as another profile's jump host.

### Picking instances from AWS

Press **Pick from AWS…** in the form to choose the instance from a list, or use **Import from AWS…** in the Import / Export menu of the connection manager to create several profiles at once.

1. Enter the IAM Identity Center start URL and region and press **Sign in**; the browser approval is the same as for S3 profiles.
2. Choose **Account**, **Role** and **Region**, then press **Find instances**.
3. Select the instances (<kbd>Enter</kbd> or <kbd>Space</kbd> toggles a row), check the **SSH login name** (suggested from the platform) and, for an import, the **Folder** (default `AWS/<account>/<region>`).

> [!NOTE]
> Only nodes that are online in Systems Manager are listed (EC2 instances and hybrid `mi-…` nodes), so an instance without the SSM Agent or an instance profile will not appear, and the list cannot tell whether an SSH daemon is running. The role needs `ssm:DescribeInstanceInformation`. The list is cut at 500 instances; narrow it with another account or region. Instance names are the SSM computer name, not the EC2 Name tag.

### Technical Internals: ProxyCommand

sshs3 adds `-o ProxyCommand=…aws ssm start-session --target %h --document-name AWS-StartSSHSession --parameters portNumber=%p` to every `ssh` it starts for the profile. Region, profile and instance ID are validated before use. When you pick a credential source in the form, sshs3 clears ambient AWS key variables for that connection; with **Default AWS CLI credentials** your environment is left alone.

## 3. Limits

- AWS offers no session logging for SSH over SSM.
- The AWS CLI itself caches short-lived role credentials in `~/.aws/cli/cache`; sshs3 does not write them.
- Sign-in and instance listing do not use an HTTP proxy or custom CA setting (S3 profiles have those per profile); on a network that only reaches AWS through a proxy, enter the instance ID by hand.
- On Windows every connection opens its own SSM session (no connection sharing).
- SSM profiles are not exported to `~/.ssh/config`, and the performance bar does not show a TCP ping.
- Plain SSM shell without sshd is not available yet.

## 4. Troubleshooting & Diagnostics

| Symptom | Probable Root Cause | Corrective Action |
|---------|--------------------|-------------------|
| Tool panel says **Missing** | AWS CLI or plugin not installed, or not in a standard folder | Install both; the panel updates on its own, or press **Check again**. |
| Panel says **Too old** | Session Manager plugin below 1.1.23.0 | Update the plugin. |
| Connection closes immediately | Instance not SSM-managed, no IAM permission, or no SSH daemon running | Check the instance appears in Systems Manager Fleet Manager, the IAM permissions above, and that `sshd` runs. |
| "Instance ID must look like i-…" | Hostname is a DNS name | Enter the instance ID, or disable SSM. |
| SSO sign-in expired | Identity Center session ended | Terminals sign in again automatically; otherwise press **Sign in** in the profile form, then reconnect. |
| Instance missing from **Pick from AWS…** | No SSM Agent, no instance profile, offline, or another account or region | Check Fleet Manager in the AWS console and the selected account and region. |
| "Access denied" when listing | The role lacks `ssm:DescribeInstanceInformation` | Add the permission, or enter the instance ID by hand. |
