import React, { useState } from 'react';
import { Cloud } from 'lucide-react';
import type { SSHConnectionConfig } from '@shared/types/ssh';
import { useAwsEnabled } from '../../lib/awsEnabled';
import { AwsImportFlow } from '../aws/AwsImportFlow';

interface Props {
  /** Called after the profiles were saved (or the dialog closed): refresh the list and close the menu. */
  onDone: (imported: number) => void;
  /** Saved SSH profiles: instances that already have an SSM profile are not imported twice. */
  profiles: readonly SSHConnectionConfig[];
}

/** "Import from AWS…" entry of the Import / Export menu. Hidden while AWS features are off. */
export const AwsImportMenuItem: React.FC<Props> = ({ onDone, profiles }) => {
  const awsEnabled = useAwsEnabled();
  const [open, setOpen] = useState(false);

  if (!awsEnabled) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary"
      >
        <Cloud className="h-3.5 w-3.5 text-sky-400" />
        <span>Import from AWS…</span>
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
