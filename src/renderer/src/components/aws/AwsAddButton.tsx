import React, { useState } from 'react';
import { Cloud } from 'lucide-react';
import type { SSHConnectionConfig } from '@shared/types/ssh';
import { useAwsEnabled } from '../../lib/awsEnabled';
import { AwsImportFlow } from './AwsImportFlow';

interface Props {
  /** Called after the profiles were saved (or the dialog closed): refresh the list. */
  onDone: (imported: number) => void;
  /** Saved SSH profiles: instances that already have an SSM profile are not imported twice. */
  profiles: readonly SSHConnectionConfig[];
}

/** Visible "Add from AWS…" button of the SSH tab in the connection manager. Hidden while AWS features are off. */
export const AwsAddButton: React.FC<Props> = ({ onDone, profiles }) => {
  const awsEnabled = useAwsEnabled();
  const [open, setOpen] = useState(false);

  if (!awsEnabled) return null;

  return (
    <>
      <button
        type="button"
        data-testid="add-from-aws"
        onClick={() => setOpen(true)}
        className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border-subtle bg-app-surface px-3 py-1.5 text-xs font-medium text-txt-primary shadow-sm transition-colors hover:bg-app-surface-hover"
      >
        <Cloud className="h-3.5 w-3.5 text-sky-400" aria-hidden="true" />
        Add from AWS…
      </button>
      {open && (
        <AwsImportFlow
          profiles={profiles}
          onDone={(n) => {
            setOpen(false);
            onDone(n);
          }}
        />
      )}
    </>
  );
};
