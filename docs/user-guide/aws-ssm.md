## SSH over AWS Systems Manager (Experimental)

Connect to EC2 instances (or hybrid nodes) that have no public SSH port by tunnelling SSH through AWS Systems Manager Session Manager. sshs3 hands OpenSSH the AWS-documented `ProxyCommand`, so the terminal, file manager, editor, search, directory sync, tunnels and key install all work like on any other SSH profile.

> [!IMPORTANT]
> This feature is **Experimental**. It could not yet be tested end to end against a live AWS account.

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
| Signed in with sshs3 (SSO) | Enter start URL, region, account ID and role name and press **Sign in**. sshs3 uses the same IAM Identity Center sign-in as S3 profiles and writes only a small app-owned AWS config file. |

4. Optionally set a **Region**. The tool panel shows whether the AWS CLI and plugin were found and switches to **Ready** by itself once you install them.

A jump host or outgoing proxy cannot be combined with SSM; enabling SSM clears them.

### Technical Internals: ProxyCommand

sshs3 adds `-o ProxyCommand=…aws ssm start-session --target %h --document-name AWS-StartSSHSession --parameters portNumber=%p` to every `ssh` it starts for the profile. Region, profile and instance ID are validated before use. When you pick a credential source in the form, sshs3 clears ambient AWS key variables for that connection; with **Default AWS CLI credentials** your environment is left alone.

## 3. Limits

- AWS offers no session logging for SSH over SSM.
- The AWS CLI itself caches short-lived role credentials in `~/.aws/cli/cache`; sshs3 does not write them.
- On Windows every connection opens its own SSM session (no connection sharing).
- SSM profiles are not exported to `~/.ssh/config`, and the performance bar does not show a TCP ping.
- Plain SSM shell without sshd, and picking instances from a list, are not available yet.

## 4. Troubleshooting & Diagnostics

| Symptom | Probable Root Cause | Corrective Action |
|---------|--------------------|-------------------|
| Tool panel says **Missing** | AWS CLI or plugin not installed, or not in a standard folder | Install both; the panel updates on its own, or press **Check again**. |
| Panel says **Too old** | Session Manager plugin below 1.1.23.0 | Update the plugin. |
| Connection closes immediately | Instance not SSM-managed, no IAM permission, or no SSH daemon running | Check the instance appears in Systems Manager Fleet Manager, the IAM permissions above, and that `sshd` runs. |
| "Instance ID must look like i-…" | Hostname is a DNS name | Enter the instance ID, or disable SSM. |
| SSO sign-in expired | Identity Center session ended | Press **Sign in** in the profile form, then reconnect. |
