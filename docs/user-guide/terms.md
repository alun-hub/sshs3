## Terms of Use

**sshs3** is free, open-source software for connecting to and managing systems you are allowed to access. These terms apply to the sshs3 application on all platforms (including the Microsoft Store version) and to the sshs3 websites. They sit on top of the [MIT licence](https://github.com/alun-hub/sshs3/blob/master/LICENSE), which always governs your right to use, copy and modify the code.

Last updated: 2026-11-17.

---

## 1. Licence

| Question | Answer |
| :--- | :--- |
| What licence is sshs3 under? | MIT. You may use, copy, modify, merge, publish, distribute and sell it, provided the copyright and licence notice stay with it. |
| Is there a fee or an account? | No. sshs3 has no account system and no paid tier. |
| Where is the third-party software listed? | In [THIRD_PARTY.md](https://github.com/alun-hub/sshs3/blob/master/THIRD_PARTY.md). Each component keeps its own licence. |

---

## 2. Authorised Use Only

sshs3 is a general-purpose administration tool, in the same category as OpenSSH, PuTTY or an S3 client. You may use it only with systems, accounts, keys, networks and data that you own or have permission to access.

> [!IMPORTANT]
> You alone are responsible for having authorisation before you connect, transfer, synchronise or tunnel anything. Do not use sshs3 to gain unauthorised access to a system, to disrupt a service, to hide unlawful activity, or to break the law or the rules of a network or provider you use.

The developer does not monitor, control or see how you use the app (see the [Privacy Policy](/docs/security/privacy/)), and is not a party to your connections or to the systems you reach with them.

---

## 3. No Warranty, Limited Liability

sshs3 is provided **"as is"**, without warranty of any kind, as stated in the MIT licence. In particular:

| Topic | What it means |
| :--- | :--- |
| Availability and fitness | No promise that sshs3 is error-free, secure against every attack, or suitable for your purpose. |
| Data loss | You are responsible for backups. File transfers, synchronisation, deletes and overwrites act on real data. Check the target before you confirm. |
| Credentials | You are responsible for protecting your keys, PINs, passphrases, recovery keys and sync passwords. A lost recovery key or hardware token can make encrypted data unrecoverable. |
| Liability | To the extent the law allows, the developer and contributors are not liable for any damage, loss or claim that arises from using or being unable to use sshs3. |
| Support | Support is on a best-effort basis through GitHub Issues. There is no service-level commitment. |

Nothing in these terms limits liability that cannot be limited by law, including any statutory rights you have as a consumer.

---

## 4. Third-Party Services

sshs3 connects only to the services **you** configure: SSH hosts, S3-compatible storage, Kubernetes clusters, certificate authorities, GitHub or GitLab. Those services are run by others and have their own terms and policies, which you must follow. The developer is not responsible for them. The Microsoft Store version is also subject to the Microsoft Store terms.

---

## 5. Websites

The sshs3 websites (sshs3.com and docs.sshs3.com) provide information and downloads. The documentation describes the app as it works at the time of writing and is not a guarantee. The sites set no cookies and run no analytics; see the [Privacy Policy](/docs/security/privacy/) for what the hosting provider processes.

---

## 6. Reporting Abuse or a Problem

| You want to | Do this |
| :--- | :--- |
| Report a security vulnerability in sshs3 | Follow the [Security Policy](https://github.com/alun-hub/sshs3/blob/master/SECURITY.md) (private reporting, not a public issue). |
| Report that someone is misusing sshs3, or a legal concern | Open an issue or contact the maintainer through [github.com/alun-hub/sshs3/issues](https://github.com/alun-hub/sshs3/issues). The developer can only act on the software and the websites, not on connections you make. |
| Ask a question or report a bug | Open an issue at [github.com/alun-hub/sshs3/issues](https://github.com/alun-hub/sshs3/issues). |

---

## 7. Changes to These Terms

If these terms change, the new version is published on this page with an updated date. Versions already released stay under the licence they were released with.

---

## 8. Troubleshooting & Diagnostics

| Symptom | Probable Root Cause | Corrective Action |
| :--- | :--- | :--- |
| You are unsure whether you may connect to a host | You lack explicit permission from its owner | Ask the owner or administrator first. Do not connect without permission. |
| Encrypted sync data cannot be opened | The sync password, recovery key or hardware token is lost | The developer cannot recover it. Restore from your own backup of the profile or token. |
| You want to use sshs3 inside a company | Internal policy, not these terms, decides this | The MIT licence allows commercial use. See [Enterprise Deployment & Policy](/docs/reference/enterprise-deployment/) for machine policy. |
