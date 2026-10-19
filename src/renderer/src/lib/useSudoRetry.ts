import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { Terminal } from 'xterm';
import { isPromptLine, type CommandOutputTracker } from './terminalOutput';
import { detectSudoRetry, isRootPromptLine, type SudoRetrySuggestion } from './sudoRetry';

/** Output must be quiet this long before we decide the command has finished. */
const QUIET_MS = 250;
/** Enter is ignored this long after the prompt appears, so a reflexive double-Enter does not run it. */
const ACCEPT_GUARD_MS = 400;

export interface UseSudoRetryOptions {
  enabled: boolean;
  /** The session is known to log in as root (an SSH profile with user `root`). */
  rootUser?: boolean;
  termRef: RefObject<Terminal | null>;
  trackerRef: RefObject<CommandOutputTracker | null>;
  /** Types the suggested command into the session and presses Enter. */
  run: (sudoCommand: string) => void;
}

/**
 * Offers to re-run a command that just failed with a permission error, prefixed with `sudo`.
 * Enter on a prompt line arms the check; once output goes quiet and the shell is back at a prompt, the
 * command and its own output are inspected. Any other input, Esc, or the screen changing under the
 * offer dismisses it.
 */
export function useSudoRetry({ enabled, rootUser = false, termRef, trackerRef, run }: UseSudoRetryOptions) {
  const [suggestion, setSuggestion] = useState<SudoRetrySuggestion | null>(null);
  const suggestionRef = useRef<SudoRetrySuggestion | null>(null);
  suggestionRef.current = suggestion;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const rootUserRef = useRef(rootUser);
  rootUserRef.current = rootUser;
  const runRef = useRef(run);
  runRef.current = run;
  const armedRef = useRef(false);
  const shownAtRef = useRef(0);
  /** What the offer was built from, to notice when the screen no longer shows that command. */
  const shownSignatureRef = useRef('');
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const dismiss = useCallback(() => {
    clearTimeout(timerRef.current);
    armedRef.current = false;
    if (suggestionRef.current) setSuggestion(null);
  }, []);

  const evaluate = useCallback(() => {
    const term = termRef.current;
    const tracker = trackerRef.current;
    if (!armedRef.current || !enabledRef.current || !term || !tracker) return;
    const buf = term.buffer.active;
    if (buf.type !== 'normal') {
      armedRef.current = false;
      return;
    }
    const cursorText = buf.getLine(buf.baseY + buf.cursorY)?.translateToString(true) ?? '';
    // Still running (or waiting for input): stay armed and look again on the next output.
    if (!cursorText.trim() || !isPromptLine(cursorText)) return;
    armedRef.current = false;
    const result = tracker.lastCommandResult();
    if (!result) return;
    const found = detectSudoRetry({
      command: result.command,
      output: result.output,
      exitCode: result.exitCode,
      atRootPrompt: rootUserRef.current || isRootPromptLine(cursorText),
    });
    if (found) {
      shownAtRef.current = Date.now();
      shownSignatureRef.current = `${result.command}\n${result.output}`;
      setSuggestion(found);
    }
  }, [termRef, trackerRef]);

  /** Output arrived while an offer is showing: drop it when it no longer matches the screen. */
  const revalidate = useCallback(() => {
    if (!suggestionRef.current) return;
    const result = trackerRef.current?.lastCommandResult();
    if (!result || `${result.command}\n${result.output}` !== shownSignatureRef.current) dismiss();
  }, [trackerRef, dismiss]);

  /** The user pressed Enter in the terminal. */
  const notifyEnter = useCallback(() => {
    dismiss();
    // Only a prompt followed by a command starts something we could re-run; an answer typed into a
    // running program (`[Y/n]`, a password) or Enter inside a full-screen app does not.
    armedRef.current = enabledRef.current && Boolean(trackerRef.current?.cursorLineIsCommand());
  }, [dismiss, trackerRef]);

  /** Anything other than Enter was typed. */
  const notifyInput = useCallback(() => {
    if (suggestionRef.current) dismiss();
  }, [dismiss]);

  /** Output arrived from the session. */
  const notifyOutput = useCallback(() => {
    // A full-screen program took over the screen: whatever it printed is not a command result.
    if (termRef.current && termRef.current.buffer.active.type !== 'normal') armedRef.current = false;
    if (!armedRef.current && !suggestionRef.current) return;
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(armedRef.current ? evaluate : revalidate, QUIET_MS);
  }, [termRef, evaluate, revalidate]);

  const accept = useCallback(() => {
    const current = suggestionRef.current;
    if (!current) return;
    dismiss();
    runRef.current(current.sudoCommand);
  }, [dismiss]);

  /**
   * Key handler for the terminal's custom key hook. Returns true when the key was consumed
   * (the terminal must not forward it to the shell).
   */
  const handleKey = useCallback(
    (e: KeyboardEvent): boolean => {
      if (!suggestionRef.current || e.type !== 'keydown') return false;
      if (e.key === 'Escape') {
        e.preventDefault();
        dismiss();
        return true;
      }
      if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        if (Date.now() - shownAtRef.current >= ACCEPT_GUARD_MS) accept();
        return true;
      }
      return false;
    },
    [accept, dismiss]
  );

  useEffect(() => {
    if (!enabled) dismiss();
  }, [enabled, dismiss]);
  useEffect(() => () => clearTimeout(timerRef.current), []);

  return { suggestion, notifyEnter, notifyInput, notifyOutput, handleKey, dismiss };
}
