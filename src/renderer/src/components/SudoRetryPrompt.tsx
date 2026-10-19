interface SudoRetryPromptProps {
  /** The exact command that Enter will type. */
  command: string;
}

/** Docked below the terminal (not floating over it), so it never hides output or the prompt. */
export function SudoRetryPrompt({ command }: SudoRetryPromptProps) {
  return (
    <div
      data-testid="sudo-retry-prompt"
      role="status"
      className="flex shrink-0 items-center gap-3 border-t border-divider bg-app-surface px-3 py-1.5 text-xs text-txt-primary"
    >
      <span className="shrink-0 font-medium whitespace-nowrap">Re-run with sudo?</span>
      <code
        className="min-w-0 flex-1 truncate rounded border border-border-subtle bg-app-input px-2 py-0.5 font-mono"
        title={command}
      >
        {command}
      </code>
      <span className="flex shrink-0 items-center gap-3 whitespace-nowrap text-txt-muted">
        <span>
          <kbd className="rounded border border-border-subtle bg-app-surface-subtle px-1.5 py-0.5 text-txt-primary">Enter</kbd> Yes
        </span>
        <span>
          <kbd className="rounded border border-border-subtle bg-app-surface-subtle px-1.5 py-0.5 text-txt-primary">Esc</kbd> Dismiss
        </span>
      </span>
    </div>
  );
}
