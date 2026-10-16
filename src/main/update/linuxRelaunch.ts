import { spawn } from 'node:child_process';
import { createLogger } from '../log';

const log = createLogger('relaunch');

export interface LinuxRelaunchOptions {
  pid?: number;
  execPath?: string;
  appImagePath?: string;
  desktopName?: string;
  args?: string[];
  maxWaitSeconds?: number;
}

/**
 * Builds a standalone shell script that waits for the exiting sshs3 instance to
 * terminate, releases the single-instance lock cleanly, restores the SELinux label
 * on AppImages if needed, and relaunches the app through the desktop environment
 * (gtk-launch / gio launch / systemd-run) rather than a direct fork/exec.
 *
 * This ensures the relaunched process receives a fresh systemd cgroup scope
 * under app.slice, an active logind/PAM session, and proper SELinux domain transition,
 * preventing 'sudo' and PAM failures in the integrated local terminal.
 */
function quoteShell(str: string): string {
  return `'${str.replace(/'/g, "'\\''")}'`;
}

export function buildLinuxRelaunchScript(options: LinuxRelaunchOptions = {}): string {
  const pid = typeof options.pid === 'number' && Number.isInteger(options.pid) ? options.pid : process.pid;
  const execPath = options.execPath ?? process.execPath;
  const appImagePath = options.appImagePath ?? (process.env.APPIMAGE || '');
  const desktopName = options.desktopName ?? 'sshs3.desktop';
  const maxWaitSeconds =
    typeof options.maxWaitSeconds === 'number' && options.maxWaitSeconds > 0
      ? options.maxWaitSeconds
      : 60;
  const maxWaitTicks = Math.max(10, Math.floor(maxWaitSeconds * 10));
  const args = options.args ?? process.argv.slice(1);
  const argsQuoted = args.map(quoteShell).join(' ');

  const appImagePathQuoted = quoteShell(appImagePath);
  const execPathQuoted = quoteShell(execPath);
  const desktopNameQuoted = quoteShell(desktopName);
  const desktopFileQuoted = quoteShell(`/usr/share/applications/${desktopName}`);

  const execAppImage = [appImagePathQuoted, argsQuoted].filter(Boolean).join(' ');
  const execPackage = [execPathQuoted, argsQuoted].filter(Boolean).join(' ');

  return `
OLD_PID=${pid}
WAITED=0
while kill -0 "$OLD_PID" 2>/dev/null; do
  sleep 0.1
  WAITED=$((WAITED + 1))
  if [ "$WAITED" -ge ${maxWaitTicks} ]; then
    exit 0
  fi
done

if [ -n ${appImagePathQuoted} ]; then
  unset APPDIR OWD APPIMAGE_SILENT_INSTALL
  if command -v restorecon >/dev/null 2>&1; then
    restorecon -F ${appImagePathQuoted} 2>/dev/null || true
  fi
  if command -v systemd-run >/dev/null 2>&1 && systemd-run --user --slice=app.slice true 2>/dev/null; then
    exec systemd-run --user --slice=app.slice ${execAppImage}
  else
    for fd in $(ls /proc/self/fd 2>/dev/null); do
      case "$fd" in ""|*[!0-9]*) continue ;; esac
      if [ "$fd" -gt 2 ]; then eval "exec $fd>&-" 2>/dev/null; fi
    done
    exec ${execAppImage}
  fi
else
  if [ -z "${argsQuoted}" ] && command -v gtk-launch >/dev/null 2>&1 && [ -f ${desktopFileQuoted} ]; then
    exec gtk-launch ${desktopNameQuoted}
  elif [ -z "${argsQuoted}" ] && command -v gio >/dev/null 2>&1 && [ -f ${desktopFileQuoted} ]; then
    exec gio launch ${desktopFileQuoted}
  elif command -v systemd-run >/dev/null 2>&1 && systemd-run --user --slice=app.slice true 2>/dev/null; then
    exec systemd-run --user --slice=app.slice ${execPackage}
  else
    for fd in $(ls /proc/self/fd 2>/dev/null); do
      case "$fd" in ""|*[!0-9]*) continue ;; esac
      if [ "$fd" -gt 2 ]; then eval "exec $fd>&-" 2>/dev/null; fi
    done
    exec ${execPackage}
  fi
fi
`.trim();
}

/**
 * Launches the background helper process that monitors parent termination and
 * starts a clean, top-level instance once this process exits.
 */
export function scheduleLinuxRelaunch(options: LinuxRelaunchOptions = {}): boolean {
  if (process.platform !== 'linux') return false;
  try {
    const script = buildLinuxRelaunchScript(options);
    log.info('scheduling Linux relaunch helper');
    const child = spawn('/bin/sh', ['-c', script], {
      detached: true,
      stdio: 'ignore',
      env: {
        ...process.env,
      },
    });
    child.unref();
    return true;
  } catch (err) {
    log.error('failed to schedule Linux relaunch helper', err);
    return false;
  }
}
