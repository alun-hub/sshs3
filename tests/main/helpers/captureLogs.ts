import { setLogLevel, setLogSinks } from '../../../src/main/log/Logger';

/** Collects log lines in memory (all levels) so tests can assert on what the app logged. */
export function captureLogs(): { lines: string[]; text: () => string; restore: () => void } {
  const lines: string[] = [];
  setLogSinks([{ write: (line) => lines.push(line) }]);
  setLogLevel('debug');
  return {
    lines,
    text: () => lines.join('\n'),
    restore: () => {
      setLogSinks([]);
      setLogLevel('info');
    },
  };
}
