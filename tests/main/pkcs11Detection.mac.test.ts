import fs from 'node:fs';
import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getAppPath: () => process.cwd(), getPath: () => process.cwd() } }));

import { SmartcardDetector } from '../../src/main/smartcard/SmartcardDetector';

// Only the macOS CI job runs this, after installing OpenSC and the Yubico PIV tool there: it checks the known paths
// against real installations and writes what was found, for the job to load into the packaged app.
const report = process.env.SSHS3_PKCS11_REPORT;

describe('PKCS#11 detection on a real macOS installation', () => {
  it.runIf(Boolean(report))('finds OpenSC and libykcs11', async () => {
    const found = await SmartcardDetector.detectAvailableLibraries('darwin', { onlyExisting: true });
    fs.writeFileSync(report!, found.map((lib) => `${lib.path}\n`).join(''));
    expect(found.map((lib) => lib.name)).toEqual(expect.arrayContaining(['OpenSC', 'YubiKey (libykcs11)']));
  });
});
