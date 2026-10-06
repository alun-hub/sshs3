#!/usr/bin/env node
// `npm audit --audit-level=high` with a reviewed allowlist (npm audit has no ignore option).
// Fails on any high/critical advisory that is not listed in IGNORED, including advisories
// reached through a transitive dependency chain.
import { spawnSync } from 'node:child_process';

/** Every entry needs a reason and must be re-reviewed when the dependency changes. */
const IGNORED = {
  'GHSA-86w9-cpqp-85rv':
    'node-forge RSA PKCS#1 v1.5 signature verification. Only reachable via win-ca, which uses ' +
    'forge for ASN.1/X.509 parsing of Windows cert-store entries and never verifies RSA ' +
    'signatures. No patched node-forge exists. win-ca is required (PowerShell is often locked ' +
    'down on enterprise machines). Dismissed as "not used" in Dependabot alert #11.',
};

const result = spawnSync('npm', ['audit', '--json'], { encoding: 'utf8', shell: process.platform === 'win32' });
let report;
try {
  report = JSON.parse(result.stdout);
} catch {
  console.error('npm audit did not return JSON:\n' + (result.stdout || result.stderr));
  process.exit(1);
}
if (report.error) {
  console.error(`npm audit failed: ${report.error.summary ?? JSON.stringify(report.error)}`);
  process.exit(1);
}

const vulns = report.vulnerabilities ?? {};
const isHigh = (severity) => severity === 'high' || severity === 'critical';
const advisoryId = (via) => /GHSA-[\w-]+/.exec(via.url ?? '')?.[0];
const memo = new Map();

/** True when the package has a non-ignored high+ advisory, directly or via a dependency. */
function isEffective(name, seen = new Set()) {
  if (memo.has(name)) return memo.get(name);
  if (seen.has(name)) return false;
  seen.add(name);
  const vuln = vulns[name];
  const effective =
    !!vuln &&
    vuln.via.some((via) =>
      typeof via === 'string'
        ? isEffective(via, seen)
        : isHigh(via.severity) && !(advisoryId(via) in IGNORED)
    );
  memo.set(name, effective);
  return effective;
}

const failing = Object.keys(vulns).filter((name) => isHigh(vulns[name].severity) && isEffective(name));
for (const [id, reason] of Object.entries(IGNORED)) {
  const used = Object.values(vulns).some((v) => v.via.some((via) => typeof via !== 'string' && advisoryId(via) === id));
  if (used) console.log(`npm audit: ignoring ${id} — ${reason}`);
}
if (failing.length > 0) {
  console.error(`npm audit: high/critical vulnerabilities in: ${failing.join(', ')}\nRun \`npm audit\` for details.`);
  process.exit(1);
}
console.log('npm audit: no unignored high/critical vulnerabilities.');
