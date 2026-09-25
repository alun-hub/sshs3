import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

/**
 * Manages the sshs3 local CLI shim directory (e.g. `~/.sshs3/bin`).
 * Provides an `oc` executable script so that users can run `oc login`,
 * `oc whoami`, and `oc project` directly in sshs3's local terminal sessions
 * without having OpenShift CLI installed on their host machine.
 */
export class K8sShimManager {
  public static getShimDir(): string {
    return path.join(os.homedir(), '.sshs3', 'bin');
  }

  public static ensureShim(): string {
    const binDir = this.getShimDir();
    if (!fs.existsSync(binDir)) {
      try {
        fs.mkdirSync(binDir, { recursive: true, mode: 0o755 });
      } catch {
        // Fall back to os.tmpdir() if home is read-only
        const tmpBin = path.join(os.tmpdir(), 'sshs3-bin');
        fs.mkdirSync(tmpBin, { recursive: true, mode: 0o755 });
        return tmpBin;
      }
    }

    const currentDir =
      typeof __dirname !== 'undefined'
        ? __dirname
        : path.dirname(fileURLToPath(import.meta.url));

    const distPath = path.resolve(currentDir, 'ocShimCli.cjs');
    const srcPath = path.resolve(currentDir, '../services/ocShimCli.cjs');
    const cliPath = fs.existsSync(distPath) ? distPath : srcPath;

    const nodeExec = process.execPath;

    if (process.platform === 'win32') {
      const cmdPath = path.join(binDir, 'oc.cmd');
      const cmdContent = `@echo off\r\nsetlocal\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${nodeExec}" "${cliPath}" %*\r\n`;
      try {
        fs.writeFileSync(cmdPath, cmdContent, { encoding: 'utf8' });
      } catch {
        // Ignore write failure
      }

      const ps1Path = path.join(binDir, 'oc.ps1');
      const ps1Content = `$env:ELECTRON_RUN_AS_NODE = "1"\r\n& "${nodeExec}" "${cliPath}" @args\r\n`;
      try {
        fs.writeFileSync(ps1Path, ps1Content, { encoding: 'utf8' });
      } catch {
        // Ignore write failure
      }
    } else {
      const shPath = path.join(binDir, 'oc');
      const shContent = `#!/bin/sh\nexport ELECTRON_RUN_AS_NODE=1\nexec "${nodeExec}" "${cliPath}" "$@"\n`;
      try {
        fs.writeFileSync(shPath, shContent, { encoding: 'utf8', mode: 0o755 });
      } catch {
        // Ignore write failure
      }
    }

    return binDir;
  }
}
